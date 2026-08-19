const jwt = require('jsonwebtoken');
const pool = require('../db');
const { managesASupervisor } = require('../services/backofficeAuth');

/**
 * Gates backoffice-exclusive routes. Verifies the JWT signature AND
 * re-runs the "manages a Supervisor" authorization rule against live data
 * on every request, rather than trusting a claim baked into the token at
 * login time — so access is revoked immediately if the org chart changes
 * (reassignment, designation change, deactivation), not just at next login.
 *
 * Deliberately not applied to any route the mobile app calls — see the
 * per-route comments in routes/*.js for which are shared vs
 * backoffice-only.
 */
async function requireBackofficeAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  try {
    const employeeResult = await pool.query('SELECT "EmpStatus" AS status FROM employees WHERE "EmpId" = $1', [payload.emp_id]);
    const employee = employeeResult.rows[0];
    const authorized = employee && employee.status === 'active' && (await managesASupervisor(payload.emp_id));

    if (!authorized) {
      return res.status(403).json({ error: 'You do not have access to this system.' });
    }

    req.backofficeEmpId = payload.emp_id;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireBackofficeAuth;
