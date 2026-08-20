const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { getTodaysTasks, getTasksForDate, createTask, TaskValidationError } = require('../services/tasks');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');
const { resolveBackofficeEmpId } = requireBackofficeAuth;

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Shared with mobile's Task Assignment form (a Supervisor assigning a task
// to a direct report — no backoffice session, so their own emp_id comes
// through explicitly as created_by) — this route deliberately isn't behind
// requireBackofficeAuth. But when a valid backoffice session IS present
// (the backoffice's own Create Task form always sends its token), created_by
// is always taken from that session and never from the client, same
// reasoning as admin-correction's entered_by / ramzan's declared_by: an
// authenticated admin shouldn't be able to attribute a task to someone else.
router.post('/', async (req, res, next) => {
  try {
    const { emp_id, project_code, priority, description, location_site, source, created_by } = req.body;
    const backofficeEmpId = await resolveBackofficeEmpId(req);
    const task = await createTask({
      emp_id, project_code, priority, description, location_site, source,
      created_by: backofficeEmpId || created_by,
    });
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof TaskValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// Backoffice-only (full task list) — mobile only ever creates tasks
// (POST / above) or reads its own via /me/:emp_id, never lists everyone's.
router.get('/', requireBackofficeAuth, async (req, res, next) => {
  try {
    // task_date::text — a bare 'date' column serialized via node-pg's
    // default Date-object handling gets rendered through the local process
    // timezone (same issue already fixed for ot_approvals.work_date),
    // shifting the displayed value by a day. Casting to text sends the
    // plain 'YYYY-MM-DD' string a JSON API consumer expects.
    const result = await pool.query(
      `SELECT t.id, t.emp_id, e."EmpName" AS employee_name, t.project_code, p.project_name,
              t.task_date::text AS task_date, t.priority, t.description, t.location_site, t.status, t.source, t.created_by, t.created_at
       FROM tasks t
       LEFT JOIN employees e ON e."EmpId" = t.emp_id
       LEFT JOIN projects p ON p.project_code = t.project_code
       ORDER BY t.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Date-wise export — every task whose task_date matches, as a downloadable
// .xlsx. Generated on-demand, same convention as the confirmation-sheet
// report (never pushed anywhere automatically). Backoffice-only.
router.get('/export', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date || !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
    }

    const result = await pool.query(
      `SELECT t.id, t.emp_id, e."EmpName" AS employee_name, t.project_code, p.project_name,
              t.priority, t.description, t.location_site, t.status, t.source, t.created_by, t.created_at
       FROM tasks t
       LEFT JOIN employees e ON e."EmpId" = t.emp_id
       LEFT JOIN projects p ON p.project_code = t.project_code
       WHERE t.task_date = $1
       ORDER BY t.created_at ASC`,
      [date]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tasks');
    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Employee', key: 'employee_name', width: 22 },
      { header: 'Project', key: 'project_name', width: 24 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Location', key: 'location_site', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Source', key: 'source', width: 14 },
      { header: 'Created By', key: 'created_by', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of result.rows) sheet.addRow(row);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="tasks-${date}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// Backoffice-only — powers the Add Punch modal's project restriction: an
// admin correcting attendance may only pick a project the employee actually
// has a real task for on that date, or (if none) their department default —
// never an arbitrary project off a free dropdown. Deduped by project_code,
// same reasoning as mobile's PunchProjectList (a task list can reference the
// same project more than once).
router.get('/punchable-projects', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id, date } = req.query;
    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!date || !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const tasks = await getTasksForDate(emp_id, date);
    const seen = new Map();
    for (const task of tasks) {
      if (!seen.has(task.project_code)) {
        seen.set(task.project_code, { project_code: task.project_code, is_default: task.is_default });
      }
    }
    res.json({ emp_id, date, projects: [...seen.values()] });
  } catch (err) {
    next(err);
  }
});

router.get('/me/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const employeeResult = await pool.query(
      'SELECT emp_id FROM employees WHERE emp_id = $1',
      [emp_id]
    );
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const tasks = await getTodaysTasks(emp_id);
    res.json({ emp_id, tasks });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
