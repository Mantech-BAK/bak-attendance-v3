const express = require('express');
const pool = require('../db');
const { getTodaysTasks, createTask, TaskValidationError } = require('../services/tasks');

const router = express.Router();

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
      `SELECT t.id, t.emp_id, e.name AS employee_name, t.project_code, p.project_name,
              t.task_date, t.priority, t.description, t.location_site, t.status, t.source, t.created_by, t.created_at
       FROM tasks t
       LEFT JOIN employees e ON e.emp_id = t.emp_id
       LEFT JOIN projects p ON p.project_code = t.project_code
       ORDER BY t.created_at DESC`
    );
    res.json(result.rows);
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
