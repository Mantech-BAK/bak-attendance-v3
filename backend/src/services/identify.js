const pool = require('../db');

/**
 * Shared employee-credential lookup — typed { emp_id, login_code }
 * identification (see routes/punch.js for the full temporary-measure
 * rationale). Used by both the mobile identify/punch flow and the
 * backoffice login flow, so the two never drift on what counts as valid
 * credentials.
 *
 * Returns the employee row (emp_id, name, designation, status, login_code)
 * on a match, or null on any mismatch — unknown emp_id and wrong code both
 * resolve to null so callers can give a single generic rejection without
 * revealing which one occurred.
 */
async function verifyEmployeeCredentials(empId, loginCode) {
  if (!empId || !loginCode) return null;

  const result = await pool.query(
    `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
            e."EmpStatus" AS status, e.login_code
     FROM employees e
     LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
     WHERE e."EmpId" = $1`,
    [String(empId).trim()]
  );
  const employee = result.rows[0];

  if (!employee || employee.login_code !== String(loginCode).trim().toUpperCase()) {
    return null;
  }

  return employee;
}

/**
 * Same employee lookup as verifyEmployeeCredentials, minus the login_code
 * check — used by the face-identify route, which has already established
 * identity via faceMatch.identifyByFace and just needs the display fields.
 */
async function getEmployeeById(empId) {
  const result = await pool.query(
    `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
            e."EmpStatus" AS status
     FROM employees e
     LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
     WHERE e."EmpId" = $1`,
    [String(empId).trim()]
  );
  return result.rows[0] || null;
}

module.exports = { verifyEmployeeCredentials, getEmployeeById };
