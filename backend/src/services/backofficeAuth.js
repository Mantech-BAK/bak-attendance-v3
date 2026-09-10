const pool = require('../db');

/**
 * Backoffice access rule: an employee may access the backoffice only if
 * their EmpId is the EmpReportMgrId (reporting manager) of at least one
 * employee flagged is_supervisor. Computed fresh from live employees data
 * every call — never hardcoded to specific emp_ids, and picks up org-chart
 * changes (reassignment, is_supervisor toggled) immediately.
 *
 * Deliberately NOT based on designation_name = 'Supervisor' — real company
 * designations are things like "Operations Manager" or "Warehouse
 * Supervisor", never literally "Supervisor", so a designation-string check
 * would silently authorize nobody once real data replaces test data.
 * is_supervisor is a separate admin-set flag, decoupled from job title.
 */
async function managesASupervisor(empId) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM employees sub
       WHERE sub."EmpReportMgrId" = $1 AND sub.is_supervisor = true
     ) AS authorized`,
    [empId]
  );
  return result.rows[0].authorized;
}

module.exports = { managesASupervisor };
