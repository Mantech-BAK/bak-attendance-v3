const express = require('express');
const pool = require('../db');
const { reverseGeocode } = require('../services/reverseGeocode');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.emp_id, e.name AS employee_name, e.designation AS employee_designation,
              p.project_code, pr.project_name, p.punch_time, p.lat, p.lng, p.entry_method,
              p.entered_by, p.approval_status, p.approved_by, p.approved_at, p.rejection_reason,
              p.resolved_address, p.created_at
       FROM punches p
       LEFT JOIN employees e ON e.emp_id = p.emp_id
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

    const supervisorResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
    }

    const pendingResult = await pool.query(
      `SELECT p.id, p.emp_id, e.name AS employee_name, p.project_code,
              p.punch_time, p.lat, p.lng, p.entry_method, p.entered_by
       FROM punches p
       JOIN employees e ON e.emp_id = p.emp_id
       WHERE e.reporting_manager_emp_id = $1 AND p.approval_status = 'pending'
       ORDER BY p.punch_time ASC`,
      [supervisor_emp_id]
    );

    res.json(pendingResult.rows);
  } catch (err) {
    next(err);
  }
});

async function loadPunchForApproval(punchId, supervisorEmpId) {
  const punchResult = await pool.query(
    `SELECT p.id, p.approval_status, e.reporting_manager_emp_id
     FROM punches p
     JOIN employees e ON e.emp_id = p.emp_id
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

    const supervisorResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [supervisor_emp_id]);
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

    const supervisorResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [supervisor_emp_id]);
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
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng are required numbers' });
    }

    const enteredBy = entered_by || emp_id;

    const employeeResult = await pool.query(
      'SELECT emp_id, reporting_manager_emp_id FROM employees WHERE emp_id = $1',
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
    }

    let entryMethod = 'self';
    let approvalStatus = 'pending';

    if (enteredBy !== emp_id) {
      entryMethod = 'supervisor';

      const enteredByResult = await pool.query(
        'SELECT emp_id, designation FROM employees WHERE emp_id = $1',
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
      [emp_id, project_code || null, punchTime, lat, lng, device_ref || null, enteredBy, entryMethod, approvalStatus, resolvedAddress]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
