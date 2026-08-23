const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { getTodaysTasks, getTasksForDate, createTask, TaskValidationError } = require('../services/tasks');
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
