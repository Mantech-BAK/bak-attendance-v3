const express = require('express');
const pool = require('../db');
const { runDailyOtJob } = require('../services/otApprovals');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');
const { resolveBackofficeEmpId } = requireBackofficeAuth;

const router = express.Router();

// Manual trigger for testing the OT job outside its 00:30 daily schedule.
// Accepts an optional { date } body to evaluate a specific past date instead
// of "yesterday". Backoffice-only — mobile never triggers this job, only
// reads its results via /pending below (shared, stays unauthenticated).
router.post('/run-daily-job', requireBackofficeAuth, async (req, res, next) => {
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

// bypassManagerCheck mirrors punches.js's loadPunchForApproval — only ever
// true for an authenticated backoffice session (item 3), since an admin
// isn't literally anyone's reporting manager.
async function loadOtApprovalForAction(id, actingEmpId, { bypassManagerCheck } = {}) {
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

  if (!bypassManagerCheck && approval.reporting_manager_emp_id !== actingEmpId) {
    return { error: { status: 403, message: `${actingEmpId} is not the reporting manager for this employee` } };
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
    const backofficeEmpId = await resolveBackofficeEmpId(req);
    const actingEmpId = backofficeEmpId || supervisor_emp_id;

    if (!actingEmpId) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const { approval, error } = await loadOtApprovalForAction(id, actingEmpId, { bypassManagerCheck: !!backofficeEmpId });
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE ot_approvals
       SET status = 'approved', approved_by = $1, approved_at = now()
       WHERE id = $2
       RETURNING id, emp_id, work_date::text AS work_date, worked_minutes, threshold_minutes, ot_minutes, status, approved_by, approved_at`,
      [actingEmpId, approval.id]
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
    const backofficeEmpId = await resolveBackofficeEmpId(req);
    const actingEmpId = backofficeEmpId || supervisor_emp_id;

    if (!actingEmpId) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const { approval, error } = await loadOtApprovalForAction(id, actingEmpId, { bypassManagerCheck: !!backofficeEmpId });
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE ot_approvals
       SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = now()
       WHERE id = $3
       RETURNING id, emp_id, work_date::text AS work_date, worked_minutes, threshold_minutes, ot_minutes, status, rejection_reason, approved_by, approved_at`,
      [String(reason).trim(), actingEmpId, approval.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Backoffice-only "Approve All" (2026-09-28) — same contract as
// punches.js's own /bulk-approve: client sends the exact ids of whatever it
// currently has visible after its own date-range/filter selection,
// approved_by always comes from the session, and each id is re-validated
// against live DB state via the UPDATE's own WHERE status = 'pending'
// (what actually makes this race-safe). One id failing never aborts the
// rest — each is independent.
router.post('/bulk-approve', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const approved = [];
    const skipped = [];

    for (const rawId of ids) {
      const id = Number(rawId);
      if (!Number.isInteger(id)) {
        skipped.push({ id: rawId, reason: 'invalid id' });
        continue;
      }

      const result = await pool.query(
        `UPDATE ot_approvals
         SET status = 'approved', approved_by = $1, approved_at = now()
         WHERE id = $2 AND status = 'pending'
         RETURNING id`,
        [req.backofficeEmpId, id]
      );

      if (result.rows.length === 1) {
        approved.push(id);
        continue;
      }

      const existing = await pool.query('SELECT status FROM ot_approvals WHERE id = $1', [id]);
      skipped.push({
        id,
        reason: existing.rows.length === 0 ? 'OT request no longer exists' : `already ${existing.rows[0].status}`,
      });
    }

    res.json({ approved, skipped });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
