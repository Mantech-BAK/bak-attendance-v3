const express = require('express');
const pool = require('../db');
const { calculateAttendanceForEmployee } = require('../services/attendance');

const router = express.Router();

router.get('/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const employeeResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const { sessions, exceptionsRaised } = await calculateAttendanceForEmployee(emp_id);

    res.json({ emp_id, sessions, exceptions_raised: exceptionsRaised });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
