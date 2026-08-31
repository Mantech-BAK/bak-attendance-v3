const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { getTodaysTasks, getTasksForDate, getTodaysTaskList, createTask, createTasksBulk, TaskValidationError } = require('../services/tasks');
const { buildTaskTemplateWorkbook, processBulkUpload } = require('../services/taskBulkUpload');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');
const { resolveBackofficeEmpId } = requireBackofficeAuth;

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    if (!EXCEL_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Unsupported file type. Upload an .xlsx file.'));
      return;
    }
    cb(null, true);
  },
});

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

/**
 * Admin-only task edit — same validation as creating one (project must
 * exist, description required, the same emp_id+day+project+description
 * duplicate rule), with this task's own id excluded from the duplicate
 * check so saving without actually changing anything doesn't collide with
 * itself. emp_id is never editable here — reassigning a task to a
 * different employee isn't a "correction," it's a different task; delete
 * and re-create instead (same reasoning as punch edit's emp_id lock).
 * display_id is also never regenerated on edit — it's a permanent
 * reference id fixed at creation, even if task_date is later corrected.
 *
 * Blocked outright (409) once the task is Completed — has reached its
 * 2-punch cap (see checkTaskPunchCap in punchValidation.js). Not Started
 * (0 punches) and Pending (1 punch) tasks stay editable; only Completed
 * ones are locked, since a task with a real open+close pair recorded
 * against it shouldn't have its project/description rewritten out from
 * under that attendance data.
 */
router.put('/:id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { project_code, priority, description, location_site, task_date } = req.body;

    const existingResult = await pool.query('SELECT id, emp_id FROM tasks WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: `task ${id} not found` });
    }
    const empId = existingResult.rows[0].emp_id;

    const punchCountResult = await pool.query(
      `SELECT count(*)::int AS cnt FROM punches WHERE task_id = $1 AND approval_status <> 'rejected'`,
      [id]
    );
    if (punchCountResult.rows[0].cnt >= 2) {
      return res.status(409).json({ error: 'This task is Completed (already has its 2 punches) and can no longer be edited.' });
    }

    if (!project_code) {
      return res.status(400).json({ error: 'project_code is required' });
    }
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (!task_date || !DATE_PATTERN.test(task_date)) {
      return res.status(400).json({ error: 'task_date is required in YYYY-MM-DD format' });
    }

    const projectResult = await pool.query('SELECT project_code FROM projects WHERE project_code = $1', [project_code]);
    if (projectResult.rows.length === 0) {
      return res.status(400).json({ error: `project ${project_code} not found` });
    }

    const duplicateResult = await pool.query(
      `SELECT id FROM tasks
       WHERE emp_id = $1 AND project_code = $2 AND task_date = $3::date AND description = $4 AND id != $5`,
      [empId, project_code, task_date, description, id]
    );
    if (duplicateResult.rows.length > 0) {
      return res.status(409).json({ error: 'This task already exists.' });
    }

    const result = await pool.query(
      `UPDATE tasks
       SET project_code = $1, priority = $2, description = $3, location_site = $4, task_date = $5::date
       WHERE id = $6
       RETURNING id, display_id, emp_id, task_date::text AS task_date, project_code, priority, description,
                 location_site, status, source, created_by, created_at`,
      [project_code, priority || null, description, location_site || null, task_date, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Real, permanent removal — blocked (409, not a silent cascade) if any
// punch already references this task via task_id, since punches.task_id
// has no ON DELETE CASCADE: deleting a task with real recorded attendance
// under it would either fail on the FK or (if it didn't) silently orphan
// that punch data. The frontend gates this behind an explicit confirmation
// dialog before ever calling it.
//
// This also happens to already be a superset of the "only Not Started or
// Pending tasks are deletable" rule (a Completed task always has 2 punches,
// which trips this block on its own) — a Pending task's single punch trips
// it too, deliberately: allowing that deletion would either violate the FK
// or silently orphan real attendance data, so unlike editing, a Pending
// task must have its punch removed first, same as always.
router.delete('/:id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const punchCountResult = await pool.query('SELECT count(*)::int AS cnt FROM punches WHERE task_id = $1', [id]);
    const punchCount = punchCountResult.rows[0].cnt;
    if (punchCount > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${punchCount} punch${punchCount === 1 ? '' : 'es'} already reference${punchCount === 1 ? 's' : ''} this task. Delete ${punchCount === 1 ? 'it' : 'them'} first.`,
      });
    }

    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `task ${id} not found` });
    }

    res.status(204).end();
  } catch (err) {
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
    // punch_count powers the Tasks page's Completed/Pending/Not Started
    // tabs (item 6): even & non-zero = Completed, odd = Pending, zero = Not
    // Started — derived client-side from this count, matching the same
    // even/odd First-In-Last-Out convention punches use everywhere else.
    // Rejected punches don't count as progress, same exclusion as every
    // other punch_count/session calculation in this app.
    const result = await pool.query(
      `SELECT t.id, t.display_id, t.emp_id, e."EmpName" AS employee_name, t.project_code, p.project_name,
              t.task_date::text AS task_date, t.priority, t.description, t.location_site, t.status, t.source, t.created_by, t.created_at,
              (SELECT count(*)::int FROM punches pu WHERE pu.task_id = t.id AND pu.approval_status <> 'rejected') AS punch_count
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
      { header: 'Employee ID', key: 'emp_id', width: 12 },
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

// Blank starter file for bulk task creation — same six columns the Teams
// intake path already accepts (teamsParser.js's COLUMNS), so an admin
// familiar with that flow sees a consistent layout here. Backoffice-only.
router.get('/template', requireBackofficeAuth, async (req, res, next) => {
  try {
    const workbook = await buildTaskTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="task-upload-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// Partial-success bulk creation from a filled-in copy of the template above
// — valid rows create tasks immediately, invalid rows (bad employee ID,
// inactive employee, bad project code, bad priority, duplicate, missing
// field) are collected and reported per-row rather than failing the whole
// file. created_by is always the authenticated admin (req.backofficeEmpId),
// never read from the spreadsheet — same reasoning as every other
// session-derived identity in this app (admin-correction's entered_by,
// ramzan's declared_by, Create Task's created_by).
router.post('/bulk-upload', requireBackofficeAuth, uploadExcel.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required (field name: "file")' });
    }

    const result = await processBulkUpload(req.file.buffer, req.backofficeEmpId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TaskValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// Assigns one identical task (same project/priority/description/location)
// to multiple employees at once from the Create Task form's multi-select
// picker — one row per emp_id, partial-success like bulk-upload above: a
// duplicate or validation failure for one employee never blocks the others
// in the same batch. Backoffice-only; created_by is always the
// authenticated admin, never read from the request body.
router.post('/bulk-assign', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_ids, project_code, priority, description, location_site } = req.body;
    const result = await createTasksBulk({
      emp_ids, project_code, priority, description, location_site,
      source: 'backoffice',
      created_by: req.backofficeEmpId,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TaskValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// Backoffice-only — powers the Add Punch modal's task picker: an admin
// correcting attendance may only pick a task the employee is actually
// assigned on that date, or (if none) their department default project —
// never an arbitrary task/project off a free dropdown. Deliberately NOT
// deduped by project_code — two tasks sharing a project are two separate,
// independently punchable selections now that punches track task_id.
router.get('/punchable-tasks', requireBackofficeAuth, async (req, res, next) => {
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
    res.json({ emp_id, date, tasks });
  } catch (err) {
    next(err);
  }
});

router.get('/me/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const employeeResult = await pool.query(
      'SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1',
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

// Mobile's "My Tasks" list (item 2) — a read-only view of everything the
// employee has today, Completed included (unlike /me/:emp_id above, which
// backs the punch-selection picker and deliberately drops Completed tasks).
// Same unauthenticated, mobile-facing shape as /me/:emp_id.
router.get('/my-list/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const employeeResult = await pool.query(
      'SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1',
      [emp_id]
    );
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const tasks = await getTodaysTaskList(emp_id);
    res.json({ emp_id, tasks });
  } catch (err) {
    next(err);
  }
});

// Handles Multer errors (bad mime type, file too large) with a clean 400
// instead of falling through to the default Express error page — same
// pattern as routes/employees.js's face-upload handler.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
