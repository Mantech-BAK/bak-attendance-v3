const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { getTodaysTasks, createTask, TaskValidationError } = require('../services/tasks');

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

router.post('/', async (req, res, next) => {
  try {
    const { emp_id, project_code, priority, description, location_site, source, created_by } = req.body;
    const task = await createTask({ emp_id, project_code, priority, description, location_site, source, created_by });
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof TaskValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.emp_id, e."EmpName" AS employee_name, t.project_code, p.project_name,
              t.task_date, t.priority, t.description, t.location_site, t.status, t.source, t.created_by, t.created_at
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
// report (never pushed anywhere automatically).
router.get('/export', async (req, res, next) => {
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
