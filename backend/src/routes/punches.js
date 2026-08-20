const express = require('express');
const pool = require('../db');
const { reverseGeocode } = require('../services/reverseGeocode');
const { getOpenProjectForToday } = require('../services/attendance');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

// Client-side hint for the mobile app's project picker — which project (if
// any) is currently open for this employee today. Not itself the
// enforcement point; POST / re-checks this same thing server-side
// regardless of what the client believes.
router.get('/today-status', async (req, res, next) => {
  try {
    const { emp_id } = req.query;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const openProjectCode = await getOpenProjectForToday(emp_id);
    res.json({ open_project_code: openProjectCode });
  } catch (err) {
    next(err);
  }
});

// Backoffice-only (full punch list, any employee) — mobile only ever reads
// its own scoped views (today-status, pending, team-history below).
router.get('/', requireBackofficeAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, g.designation_name AS employee_designation,
              p.project_code, pr.project_name, p.punch_time, p.lat, p.lng, p.entry_method,
              p.entered_by, p.approval_status, p.approved_by, p.approved_at, p.rejection_reason,
              p.resolved_address, p.created_at
       FROM punches p
       LEFT JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       ORDER BY p.punch_time DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/pending', async (req, res, next) => {
  try {
    const { supervisor_emp_id } = req.query;

    if (!supervisor_emp_id) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
    }

    const pendingResult = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code,
              p.punch_time, p.lat, p.lng, p.entry_method, p.entered_by
       FROM punches p
       JOIN employees e ON e."EmpId" = p.emp_id
       WHERE e."EmpReportMgrId" = $1 AND p.approval_status = 'pending'
       ORDER BY p.punch_time ASC`,
      [supervisor_emp_id]
    );

    res.json(pendingResult.rows);
  } catch (err) {
    next(err);
  }
});

// Read-only punch history for a supervisor's own team — every punch
// (any approval status) for their direct reports, most recent first. No
// approve/reject action lives here; that's still /pending above. Capped at
// 200 rows so a long-tenured team's history doesn't return unbounded data.
router.get('/team-history', async (req, res, next) => {
  try {
    const { supervisor_emp_id } = req.query;

    if (!supervisor_emp_id) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
    }

    const historyResult = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code, pr.project_name,
              p.punch_time, p.entry_method, p.entered_by, p.approval_status, p.rejection_reason
       FROM punches p
       JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       WHERE e."EmpReportMgrId" = $1
       ORDER BY p.punch_time DESC
       LIMIT 200`,
      [supervisor_emp_id]
    );

    res.json(historyResult.rows);
  } catch (err) {
    next(err);
  }
});

async function loadPunchForApproval(punchId, supervisorEmpId) {
  const punchResult = await pool.query(
    `SELECT p.id, p.approval_status, e."EmpReportMgrId" AS reporting_manager_emp_id
     FROM punches p
     JOIN employees e ON e."EmpId" = p.emp_id
     WHERE p.id = $1`,
    [punchId]
  );

  if (punchResult.rows.length === 0) {
    return { error: { status: 404, message: `punch ${punchId} not found` } };
  }

  const punch = punchResult.rows[0];

  if (punch.reporting_manager_emp_id !== supervisorEmpId) {
    return { error: { status: 403, message: `${supervisorEmpId} is not the reporting manager for this punch` } };
  }

  if (punch.approval_status !== 'pending') {
    return { error: { status: 409, message: `punch ${punchId} has already been ${punch.approval_status}` } };
  }

  return { punch };
}

router.patch('/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { supervisor_emp_id } = req.body;

    if (!supervisor_emp_id) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(400).json({ error: `supervisor_emp_id ${supervisor_emp_id} not found` });
    }

    const { punch, error } = await loadPunchForApproval(id, supervisor_emp_id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE punches
       SET approval_status = 'approved', approved_by = $1, approved_at = now()
       WHERE id = $2
       RETURNING id, emp_id, project_code, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, rejection_reason, created_at`,
      [supervisor_emp_id, punch.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { supervisor_emp_id, reason } = req.body;

    if (!supervisor_emp_id) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(400).json({ error: `supervisor_emp_id ${supervisor_emp_id} not found` });
    }

    const { punch, error } = await loadPunchForApproval(id, supervisor_emp_id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE punches
       SET approval_status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = now()
       WHERE id = $3
       RETURNING id, emp_id, project_code, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, rejection_reason, created_at`,
      [String(reason).trim(), supervisor_emp_id, punch.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { emp_id, project_code, lat, lng, entered_by, device_ref } = req.body;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    // Location is best-effort, not required — a device with GPS/location
    // disabled or a failed lookup must still be able to punch. lat/lng are
    // only rejected if the client sent something that isn't actually a
    // valid coordinate; omitting them entirely (null/undefined) is fine and
    // stores as NULL, same as admin-correction already does.
    const hasLat = lat !== null && lat !== undefined;
    const hasLng = lng !== null && lng !== undefined;
    if (hasLat !== hasLng) {
      return res.status(400).json({ error: 'lat and lng must both be provided or both be omitted' });
    }
    if (hasLat && (typeof lat !== 'number' || typeof lng !== 'number')) {
      return res.status(400).json({ error: 'lat and lng must be numbers when provided' });
    }

    const enteredBy = entered_by || emp_id;

    const employeeResult = await pool.query(
      'SELECT "EmpId" AS emp_id, "EmpReportMgrId" AS reporting_manager_emp_id FROM employees WHERE "EmpId" = $1',
      [emp_id]
    );
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }
    const targetEmployee = employeeResult.rows[0];

    if (project_code) {
      const projectResult = await pool.query(
        'SELECT project_code FROM projects WHERE project_code = $1',
        [project_code]
      );
      if (projectResult.rows.length === 0) {
        return res.status(400).json({ error: `project ${project_code} not found` });
      }

      // Only one project can be genuinely "in progress" at a time. Punching
      // a different project than whichever one is currently open (odd punch
      // count today) is rejected — punching that same open project again
      // (to close it) is always allowed regardless of this check.
      const openProjectCode = await getOpenProjectForToday(emp_id);
      if (openProjectCode && openProjectCode !== project_code) {
        return res.status(409).json({
          error: `${emp_id} has an open punch for project ${openProjectCode} today — close it before punching a different project`,
          open_project_code: openProjectCode,
        });
      }
    }

    let entryMethod = 'self';
    let approvalStatus = 'pending';

    if (enteredBy !== emp_id) {
      entryMethod = 'supervisor';

      const enteredByResult = await pool.query(
        `SELECT e."EmpId" AS emp_id, g.designation_name AS designation
         FROM employees e
         LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
         WHERE e."EmpId" = $1`,
        [enteredBy]
      );
      if (enteredByResult.rows.length === 0) {
        return res.status(400).json({ error: `entered_by ${enteredBy} not found` });
      }

      // A supervisor may only punch on behalf of their own direct reports.
      if (targetEmployee.reporting_manager_emp_id !== enteredBy) {
        return res.status(403).json({ error: `${emp_id} does not report to ${enteredBy}` });
      }

      // Auto-approval is gated on the literal designation string "Supervisor",
      // not on "is a reporting manager" generally. A reporting manager whose
      // designation is something else (e.g. "Operations Manager") is a valid
      // entered_by and passes the check above, but their entries still land
      // as 'pending' and surface in their own GET /pending list for review.
      //
      // CONFIRMED INTENDED (2026-07-28) — not an oversight. Do not widen this
      // to "any reporting manager" without an explicit product decision to
      // do so; narrowing who gets auto-approval was a deliberate choice.
      approvalStatus = enteredByResult.rows[0].designation === 'Supervisor' ? 'approved' : 'pending';
    }

    // punch_time is always the server's clock at receipt — never trust a
    // client-supplied timestamp, since shared devices with skewed clocks
    // would corrupt the ordering that attendance calculation depends on.
    const punchTime = new Date();

    // Real reverse geocoding via Nominatim, resolved synchronously right
    // here. Never blocks or fails the punch — reverseGeocode() resolves to
    // null on any timeout/error rather than throwing.
    const resolvedAddress = await reverseGeocode(lat, lng);

    const result = await pool.query(
      `INSERT INTO punches
         (emp_id, project_code, punch_time, lat, lng, device_ref, entered_by, entry_method, approval_status, resolved_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, emp_id, project_code, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, resolved_address, created_at`,
      [emp_id, project_code || null, punchTime, lat ?? null, lng ?? null, device_ref || null, enteredBy, entryMethod, approvalStatus, resolvedAddress]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// A second punch for the same employee/project within this many minutes of
// an existing one is flagged as a likely duplicate — close enough in time
// that it's far more likely a double-submit than two genuinely distinct
// corrections, but not blocked outright since an admin occasionally does
// need two close entries (e.g. a quick in/out correction).
const DUPLICATE_WINDOW_MINUTES = 5;

/**
 * Admin-only manual punch correction — for backfilling a punch an employee
 * never actually recorded (most commonly to resolve a single_punch_only
 * exception), or any other missing entry. Deliberately a separate endpoint
 * from POST / rather than a variant of it: this accepts an explicit
 * admin-supplied punch_time instead of trusting the server clock, skips the
 * "already has an open project today" 409 (the whole point is often to
 * close out a stale open session from a past day, which that check isn't
 * scoped to catch anyway), and is unconditionally auto-approved — an admin
 * directly correcting attendance data is a trusted, deliberate action, not
 * something that then needs someone else's review.
 *
 * entered_by is never taken from the request body — it's always the
 * authenticated admin from the session token (req.backofficeEmpId), same
 * as every other backoffice-authed write. Passing it explicitly would let
 * one logged-in admin attribute a correction to someone else.
 */
router.post('/admin-correction', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id, project_code, punch_time, force } = req.body;
    const enteredBy = req.backofficeEmpId;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!punch_time) {
      return res.status(400).json({ error: 'punch_time is required' });
    }
    const parsedPunchTime = new Date(punch_time);
    if (Number.isNaN(parsedPunchTime.getTime())) {
      return res.status(400).json({ error: 'punch_time is not a valid timestamp' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    if (project_code) {
      const projectResult = await pool.query('SELECT project_code FROM projects WHERE project_code = $1', [project_code]);
      if (projectResult.rows.length === 0) {
        return res.status(400).json({ error: `project ${project_code} not found` });
      }
    }

    if (!force) {
      const duplicateResult = await pool.query(
        `SELECT id, punch_time, entry_method, approval_status
         FROM punches
         WHERE emp_id = $1
           AND project_code IS NOT DISTINCT FROM $2
           AND punch_time BETWEEN $3::timestamp - (INTERVAL '1 minute' * $4) AND $3::timestamp + (INTERVAL '1 minute' * $4)
         ORDER BY punch_time
         LIMIT 1`,
        [emp_id, project_code || null, parsedPunchTime, DUPLICATE_WINDOW_MINUTES]
      );
      if (duplicateResult.rows.length > 0) {
        return res.status(409).json({
          error: `${emp_id} already has a punch for this project within ${DUPLICATE_WINDOW_MINUTES} minutes of this time.`,
          duplicate: duplicateResult.rows[0],
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO punches
         (emp_id, project_code, punch_time, lat, lng, entered_by, entry_method, approval_status, approved_by, approved_at)
       VALUES ($1, $2, $3, NULL, NULL, $4, 'admin_correction', 'approved', $4, now())
       RETURNING id, emp_id, project_code, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, resolved_address, created_at`,
      [emp_id, project_code || null, parsedPunchTime, enteredBy]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
