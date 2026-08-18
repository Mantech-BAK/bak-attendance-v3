const express = require('express');
const pool = require('../db');
const { runDailyOtJob } = require('../services/otApprovals');

const router = express.Router();

// Manual trigger for testing the OT job outside its 00:30 daily schedule.
// Accepts an optional { date } body to evaluate a specific past date instead
// of "yesterday".
router.post('/run-daily-job', async (req, res, next) => {
  try {
    const { date } = req.body || {};
    const result = date ? await runDailyOtJob(date) : await runDailyOtJob();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// supervisor_emp_id is optional here: given, scoped to that supervisor's own
// team (mobile Review Attendance usage); omitted, returns every pending OT
// approval org-wide (backoffice Dashboard "Overtime Alerts" usage — item 7,
// reusing this same end-of-day OT evaluation as the detection mechanism
// rather than adding a separate one).
router.get('/pending', async (req, res, next) => {
  try {
    const { supervisor_emp_id } = req.query;

    if (supervisor_emp_id) {
      const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
      if (supervisorResult.rows.length === 0) {
        return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
      }
    }

    // work_date::text — a bare 'date' column serialized via node-pg's
    // default Date-object handling gets rendered through the local process
    // timezone (confirmed elsewhere in this app to shift the displayed
    // value), even though the stored date itself is correct. Casting to
    // text sends the plain 'YYYY-MM-DD' string a JSON API consumer expects.
    const result = await pool.query(
      `SELECT o.id, o.emp_id, e."EmpName" AS employee_name, g.designation_name AS employee_designation,
              o.work_date::text AS work_date, o.worked_minutes,
              o.threshold_minutes, o.ot_minutes, o.status
       FROM ot_approvals o
       JOIN employees e ON e."EmpId" = o.emp_id
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       WHERE o.status = 'pending' ${supervisor_emp_id ? 'AND e."EmpReportMgrId" = $1' : ''}
       ORDER BY o.work_date ASC`,
      supervisor_emp_id ? [supervisor_emp_id] : []
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

async function loadOtApprovalForAction(id, supervisorEmpId) {
  const result = await pool.query(
    `SELECT o.id, o.status, e."EmpReportMgrId" AS reporting_manager_emp_id
     FROM ot_approvals o
     JOIN employees e ON e."EmpId" = o.emp_id
     WHERE o.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return { error: { status: 404, message: `OT approval ${id} not found` } };
  }

  const approval = result.rows[0];

  if (approval.reporting_manager_emp_id !== supervisorEmpId) {
    return { error: { status: 403, message: `${supervisorEmpId} is not the reporting manager for this employee` } };
  }

  if (approval.status !== 'pending') {
    return { error: { status: 409, message: `OT approval ${id} has already been ${approval.status}` } };
  }

  return { approval };
}

router.patch('/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { supervisor_emp_id } = req.body;

    if (!supervisor_emp_id) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const { approval, error } = await loadOtApprovalForAction(id, supervisor_emp_id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE ot_approvals
       SET status = 'approved', approved_by = $1, approved_at = now()
       WHERE id = $2
       RETURNING id, emp_id, work_date::text AS work_date, worked_minutes, threshold_minutes, ot_minutes, status, approved_by, approved_at`,
      [supervisor_emp_id, approval.id]
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

    const { approval, error } = await loadOtApprovalForAction(id, supervisor_emp_id);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE ot_approvals
       SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = now()
       WHERE id = $3
       RETURNING id, emp_id, work_date::text AS work_date, worked_minutes, threshold_minutes, ot_minutes, status, rejection_reason, approved_by, approved_at`,
      [String(reason).trim(), supervisor_emp_id, approval.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
