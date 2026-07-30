const express = require('express');
const pool = require('../db');
const { getTodaysTasks } = require('../services/tasks');

const router = express.Router();

/**
 * TEMPORARY TESTING MEASURE — identification is currently a typed
 * { emp_id, login_code } pair instead of real face capture/recognition.
 * employees.login_code is a random 5-letter code (see ../services/loginCode
 * and artifySync.js's upsertEmployees, which assigns one to every new
 * employee), viewable/regeneratable by an admin from the backoffice
 * Employees page. This replaces both the old camera-capture flow and the
 * DEV identify-bypass route (routes/devBypass.js, now removed) — it's the
 * practical way to exercise the full punch/approval/OT flow without
 * biometric hardware.
 *
 * face_template/fingerprint_template and services/faceMatch.js are left
 * completely untouched and unused. Swap this back to real face capture once
 * biometric hardware/data is available — open item, tracked the same way as
 * the ARTIFY/Teams pending items.
 */
router.post('/identify', async (req, res, next) => {
  try {
    const { emp_id, login_code } = req.body || {};

    if (!emp_id || !login_code) {
      return res.status(400).json({ error: 'emp_id and login_code are required' });
    }

    const employeeResult = await pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
              e."EmpStatus" AS status, e.login_code
       FROM employees e
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       WHERE e."EmpId" = $1`,
      [String(emp_id).trim()]
    );
    const employee = employeeResult.rows[0];

    // Generic "invalid" message either way (unknown emp_id vs. wrong code) —
    // don't let this endpoint reveal whether an emp_id exists.
    if (!employee || employee.login_code !== String(login_code).trim().toUpperCase()) {
      return res.status(401).json({ error: 'Invalid employee ID or code.' });
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
