const express = require('express');
const pool = require('../db');
const { getTodaysTasks } = require('../services/tasks');

const router = express.Router();

const VALID_SOURCES = ['supervisor_app', 'backoffice', 'teams'];

router.post('/', async (req, res, next) => {
  try {
    const { emp_id, project_code, priority, description, location_site, source, created_by } = req.body;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!project_code) {
      return res.status(400).json({ error: 'project_code is required' });
    }
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (!source || !VALID_SOURCES.includes(source)) {
      return res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` });
    }
    if (!created_by) {
      return res.status(400).json({ error: 'created_by is required' });
    }

    const employeeResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const creatorResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [created_by]);
    if (creatorResult.rows.length === 0) {
      return res.status(400).json({ error: `created_by ${created_by} not found` });
    }

    const projectResult = await pool.query('SELECT project_code FROM projects WHERE project_code = $1', [project_code]);
    if (projectResult.rows.length === 0) {
      return res.status(400).json({ error: `project ${project_code} not found` });
    }

    const result = await pool.query(
      `INSERT INTO tasks (emp_id, task_date, project_code, priority, description, location_site, source, created_by)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
       RETURNING id, emp_id, task_date, project_code, priority, description, location_site, status, source, created_by, created_at`,
      [emp_id, project_code, priority || null, description, location_site || null, source, created_by]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
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
