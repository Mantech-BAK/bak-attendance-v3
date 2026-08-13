const express = require('express');
const pool = require('../db');
const { calculateAttendanceForEmployee, calculateAttendanceForAllEmployees } = require('../services/attendance');

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', async (req, res, next) => {
  try {
    const { date } = req.query;
    if (date && !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const { sessions, exceptionsRaised } = await calculateAttendanceForAllEmployees(date || undefined);
    res.json({ sessions, exceptions_raised: exceptionsRaised });
  } catch (err) {
    next(err);
  }
});

router.get('/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;
    const { date } = req.query;
    if (date && !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const { sessions, exceptionsRaised } = await calculateAttendanceForEmployee(emp_id, date || undefined);

    res.json({ emp_id, sessions, exceptions_raised: exceptionsRaised });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
