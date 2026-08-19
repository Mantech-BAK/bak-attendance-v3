const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyEmployeeCredentials } = require('../services/identify');
const { managesASupervisor } = require('../services/backofficeAuth');

const router = express.Router();

const TOKEN_TTL = '12h';

/**
 * Backoffice login — reuses the same typed { emp_id, login_code }
 * identification mobile uses (services/identify.js), then layers a
 * backoffice-specific authorization check on top: only an employee who is
 * the reporting manager of at least one Supervisor-designated employee gets
 * a session (see services/backofficeAuth.js).
 *
 * Bad credentials and valid-but-unauthorized credentials get the exact same
 * generic rejection — this endpoint never reveals which case occurred.
 */
router.post('/backoffice-login', async (req, res, next) => {
  try {
    const { emp_id, login_code } = req.body || {};

    if (!emp_id || !login_code) {
      return res.status(400).json({ error: 'emp_id and login_code are required' });
    }

    const employee = await verifyEmployeeCredentials(emp_id, login_code);
    const authorized = employee && employee.status === 'active' && (await managesASupervisor(employee.emp_id));

    if (!authorized) {
      return res.status(403).json({ error: 'You do not have access to this system.' });
    }

    const token = jwt.sign({ emp_id: employee.emp_id }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });

    res.json({ token, emp_id: employee.emp_id, name: employee.name });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
