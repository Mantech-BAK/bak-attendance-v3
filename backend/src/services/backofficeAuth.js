const pool = require('../db');

/**
 * Backoffice access rule: an employee may access the backoffice only if
 * their EmpId is the EmpReportMgrId (reporting manager) of at least one
 * employee whose designation is exactly "Supervisor". Computed fresh from
 * live employees/designations data every call — never hardcoded to
 * specific emp_ids, and picks up org-chart changes (reassignment,
 * designation changes) immediately.
 */
async function managesASupervisor(empId) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM employees sub
       JOIN designations d ON sub."EmpDesigId" = d.designation_code
       WHERE sub."EmpReportMgrId" = $1 AND d.designation_name = 'Supervisor'
     ) AS authorized`,
    [empId]
  );
  return result.rows[0].authorized;
}

module.exports = { managesASupervisor };
