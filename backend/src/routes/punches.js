const express = require('express');
const pool = require('../db');
const { reverseGeocode } = require('../services/reverseGeocode');
const {
  getOpenPunchForToday,
  getOpenPunchForDate,
  dateKey,
  punchKey,
  syncTaskSinglePunchException,
  resolveSinglePunchException,
} = require('../services/attendance');
const {
  PunchValidationError,
  resolvePunchTarget,
  checkOpenConflict,
  checkTaskPunchCap,
  checkCrossKeyTimestampClash,
  checkNearDuplicate,
} = require('../services/punchValidation');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

const PUNCH_SELECT_RETURNING = `id, emp_id, project_code, task_id, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, resolved_address, created_at`;

// Client-side hint for the mobile app's task/project picker — which task
// (or, for the department-default fallback, which project) is currently
// open for this employee today. Not itself the enforcement point; POST /
// re-checks this same thing server-side regardless of what the client
// believes.
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

    const open = await getOpenPunchForToday(emp_id);
    res.json({ open_task_id: open?.task_id ?? null, open_project_code: open?.project_code ?? null });
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
              p.project_code, pr.project_name, p.task_id, t.display_id AS task_display_id, t.description AS task_description,
              p.punch_time, p.lat, p.lng, p.entry_method,
              p.entered_by, p.approval_status, p.approved_by, p.approved_at, p.rejection_reason,
              p.resolved_address, p.created_at
       FROM punches p
       LEFT JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       LEFT JOIN tasks t ON t.id = p.task_id
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
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code, p.task_id,
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
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code, pr.project_name, p.task_id,
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
       RETURNING ${PUNCH_SELECT_RETURNING}, rejection_reason`,
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
       RETURNING ${PUNCH_SELECT_RETURNING}, rejection_reason`,
      [String(reason).trim(), supervisor_emp_id, punch.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { emp_id, task_id, project_code, lat, lng, entered_by, device_ref } = req.body;

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

    // Resolves to a specific task (project auto-filled/locked from it) when
    // task_id is given, else the bare project_code (department-default
    // fallback, unchanged from before task-tracking existed).
    const target = await resolvePunchTarget({ emp_id, task_id, project_code });

    // A task already at its 2-punch cap (Completed) can never be punched
    // again, even a genuine third attempt from the employee's own device.
    await checkTaskPunchCap({ task_id: target.task_id });

    if (target.project_code) {
      // Only one task (or, for the fallback, one project) can be genuinely
      // "in progress" at a time — globally, across every project — punching
      // something DIFFERENT while one is still open (odd punch count today)
      // is rejected; punching that same open thing again (to close it) is
      // always allowed.
      await checkOpenConflict({
        emp_id,
        task_id: target.task_id,
        project_code: target.project_code,
        date: dateKey(new Date()),
      });
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
         (emp_id, project_code, task_id, punch_time, lat, lng, device_ref, entered_by, entry_method, approval_status, resolved_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${PUNCH_SELECT_RETURNING}`,
      [emp_id, target.project_code, target.task_id, punchTime, lat ?? null, lng ?? null, device_ref || null, enteredBy, entryMethod, approvalStatus, resolvedAddress]
    );

    if (target.task_id) {
      await syncTaskSinglePunchException(target.task_id);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof PunchValidationError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    next(err);
  }
});

/**
 * Admin-only manual punch correction — for backfilling a punch an employee
 * never actually recorded (most commonly to resolve a single_punch_only
 * exception), or any other missing entry. Deliberately a separate endpoint
 * from POST / rather than a variant of it: this accepts an explicit
 * admin-supplied punch_time instead of trusting the server clock, skips the
 * "already has an open task today" 409 for TODAY specifically the way
 * POST / enforces it — this endpoint scopes that check to whatever date is
 * actually being corrected instead — and is unconditionally auto-approved —
 * an admin directly correcting attendance data is a trusted, deliberate
 * action, not something that then needs someone else's review.
 *
 * entered_by is never taken from the request body — it's always the
 * authenticated admin from the session token (req.backofficeEmpId), same
 * as every other backoffice-authed write. Passing it explicitly would let
 * one logged-in admin attribute a correction to someone else.
 */
router.post('/admin-correction', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id, task_id, project_code, punch_time, force } = req.body;
    const enteredBy = req.backofficeEmpId;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!task_id && !project_code) {
      return res.status(400).json({ error: 'task_id or project_code is required' });
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

    const target = await resolvePunchTarget({ emp_id, task_id, project_code });
    const punchDate = dateKey(parsedPunchTime);

    await checkTaskPunchCap({ task_id: target.task_id });
    await checkOpenConflict({ emp_id, task_id: target.task_id, project_code: target.project_code, date: punchDate });
    await checkCrossKeyTimestampClash({ emp_id, task_id: target.task_id, project_code: target.project_code, punchTime: parsedPunchTime });
    await checkNearDuplicate({ emp_id, task_id: target.task_id, project_code: target.project_code, punchTime: parsedPunchTime, force });

    const result = await pool.query(
      `INSERT INTO punches
         (emp_id, project_code, task_id, punch_time, lat, lng, entered_by, entry_method, approval_status, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5, 'admin_correction', 'approved', $5, now())
       RETURNING ${PUNCH_SELECT_RETURNING}`,
      [emp_id, target.project_code, target.task_id, parsedPunchTime, enteredBy]
    );

    if (target.task_id) {
      await syncTaskSinglePunchException(target.task_id);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof PunchValidationError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    next(err);
  }
});

/**
 * Admin-only punch edit — corrects an existing punch's date/time/task/
 * project after the fact. Goes through the exact same validation as
 * creating one (resolvePunchTarget, checkOpenConflict,
 * checkCrossKeyTimestampClash, checkNearDuplicate), with the punch's own id
 * excluded from every check so editing a punch's time by five minutes
 * doesn't spuriously conflict with itself. emp_id is never editable here —
 * moving a punch to a different employee isn't a "correction," it's a
 * different punch; delete and re-create instead.
 */
router.put('/:id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { task_id, project_code, punch_time, force } = req.body;
    const enteredBy = req.backofficeEmpId;

    const existingResult = await pool.query('SELECT id, emp_id, task_id FROM punches WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: `punch ${id} not found` });
    }
    const empId = existingResult.rows[0].emp_id;
    const oldTaskId = existingResult.rows[0].task_id;

    if (!task_id && !project_code) {
      return res.status(400).json({ error: 'task_id or project_code is required' });
    }
    if (!punch_time) {
      return res.status(400).json({ error: 'punch_time is required' });
    }
    const parsedPunchTime = new Date(punch_time);
    if (Number.isNaN(parsedPunchTime.getTime())) {
      return res.status(400).json({ error: 'punch_time is not a valid timestamp' });
    }

    const target = await resolvePunchTarget({ emp_id: empId, task_id, project_code });
    const punchDate = dateKey(parsedPunchTime);
    const punchId = Number(id);

    await checkTaskPunchCap({ task_id: target.task_id, excludePunchId: punchId });
    await checkOpenConflict({ emp_id: empId, task_id: target.task_id, project_code: target.project_code, date: punchDate, excludePunchId: punchId });
    await checkCrossKeyTimestampClash({ emp_id: empId, task_id: target.task_id, project_code: target.project_code, punchTime: parsedPunchTime, excludePunchId: punchId });
    await checkNearDuplicate({ emp_id: empId, task_id: target.task_id, project_code: target.project_code, punchTime: parsedPunchTime, excludePunchId: punchId, force });

    const result = await pool.query(
      `UPDATE punches
       SET project_code = $1, task_id = $2, punch_time = $3, entry_method = 'admin_correction',
           approval_status = 'approved', approved_by = $4, approved_at = now()
       WHERE id = $5
       RETURNING ${PUNCH_SELECT_RETURNING}`,
      [target.project_code, target.task_id, parsedPunchTime, enteredBy, punchId]
    );

    // Resolve first in case this punch's own id was the ref for an open
    // exception that no longer applies to it now (task/time changed) —
    // then re-evaluate both the task it left (if any, and different) and
    // whatever task it now belongs to, since either side's Pending/
    // Completed state may have just flipped.
    await resolveSinglePunchException(punchId);
    if (oldTaskId && oldTaskId !== target.task_id) {
      await syncTaskSinglePunchException(oldTaskId);
    }
    if (target.task_id) {
      await syncTaskSinglePunchException(target.task_id);
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof PunchValidationError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    next(err);
  }
});

// Admin-only punch delete — a real, permanent removal (not a soft
// approval_status change), so the frontend gates it behind an explicit
// confirmation dialog. No confirm-token requirement server-side (unlike
// Settings' reset-test-data) since this deletes exactly one identified row,
// not a whole table's worth of data.
router.delete('/:id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM punches WHERE id = $1 RETURNING id, task_id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `punch ${id} not found` });
    }
    const taskId = result.rows[0].task_id;

    // This punch no longer exists, so any open exception still referencing
    // its id no longer applies — resolve it, then re-evaluate whatever's
    // left on the task (a no-op if none, a fresh raise if exactly one
    // punch now remains).
    await resolveSinglePunchException(Number(id));
    if (taskId) {
      await syncTaskSinglePunchException(taskId);
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
