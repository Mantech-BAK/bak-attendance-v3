/**
 * DEV ONLY — remove this entire file and its mount in index.js once real
 * face recognition replaces the exact-byte-hash stub in faceMatch.js.
 *
 * Skips face matching entirely and returns an employee + their tasks in
 * the same shape as POST /api/punch/identify, so the rest of the app
 * (employee card, tasks, punch in/out, supervisor panel) can be tested
 * without a live camera capture ever being able to match a registered photo.
 */
const express = require('express');
const pool = require('../db');
const { getTodaysTasks } = require('../services/tasks');

const router = express.Router();

router.get('/identify-bypass/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const employeeResult = await pool.query(
      'SELECT emp_id, name, designation, status FROM employees WHERE emp_id = $1',
      [emp_id]
    );
    const employee = employeeResult.rows[0];

    if (!employee) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }
    if (employee.status !== 'active') {
      return res.status(403).json({ error: `Employee ${employee.emp_id} is inactive and cannot punch.` });
    }

    const tasks = await getTodaysTasks(employee.emp_id);

    res.json({
      emp_id: employee.emp_id,
      name: employee.name,
      designation: employee.designation,
      tasks,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
