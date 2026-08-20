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

/**
 * Same identity resolution as requireBackofficeAuth, but never rejects the
 * request — returns the authorized emp_id, or null on any missing, invalid,
 * expired, or unauthorized token. For routes shared with mobile (which never
 * sends an Authorization header at all) that want to recognize a logged-in
 * backoffice admin when present without hard-requiring one, e.g.
 * POST /api/tasks deriving created_by from the session when the backoffice
 * calls it, while still accepting mobile's own explicit created_by
 * (a supervisor assigning a task on a direct report, no JWT concept there).
 */
async function resolveBackofficeEmpId(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  const employeeResult = await pool.query('SELECT "EmpStatus" AS status FROM employees WHERE "EmpId" = $1', [payload.emp_id]);
  const employee = employeeResult.rows[0];
  const authorized = employee && employee.status === 'active' && (await managesASupervisor(payload.emp_id));

  return authorized ? payload.emp_id : null;
}

module.exports = requireBackofficeAuth;
module.exports.resolveBackofficeEmpId = resolveBackofficeEmpId;
