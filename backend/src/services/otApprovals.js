const pool = require('../db');
const { getAllSettings, parseRamzanPeriods } = require('./settings');
const { dateKey, getUtcDayBounds } = require('./attendance');
const { computeEmployeeDay, ensureOtApproval } = require('./dailyConfirmation');

function yesterday() {
  return dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/**
 * End-of-day OT evaluation — runs once daily via cron (see jobs/otApprovalCron.js),
 * shortly after the target day has fully closed out. For every OT-eligible,
 * active employee with at least one punch that day, computes their true
 * worked total (same gap-fold logic as the confirmation-sheet report) and,
 * if it exceeds the day's threshold, ensures a pending ot_approvals row
 * exists — idempotent via ensureOtApproval's ON CONFLICT DO NOTHING, so
 * re-running for an already-processed date is always safe.
 */
async function runDailyOtJob(date = yesterday()) {
  const [settingsMap, employeesResult] = await Promise.all([
    getAllSettings(),
    pool.query(
      `SELECT emp_id, name, designation, company, department, religion, ot_eligible, reporting_manager_emp_id
       FROM employees WHERE status = 'active' AND ot_eligible = 'Y' ORDER BY emp_id`
    ),
  ]);
  const ramzanPeriods = parseRamzanPeriods(settingsMap);

  const { start, end } = getUtcDayBounds(date);
  const punchesResult = await pool.query(
    `SELECT id, emp_id, project_code, punch_time
     FROM punches
     WHERE approval_status <> 'rejected'
       AND punch_time >= $1 AND punch_time < $2
     ORDER BY emp_id, project_code, punch_time`,
    [start, end]
  );
  const punchesByEmp = new Map();
  for (const row of punchesResult.rows) {
    if (!punchesByEmp.has(row.emp_id)) punchesByEmp.set(row.emp_id, []);
    punchesByEmp.get(row.emp_id).push(row);
  }

  let created = 0;
  for (const employee of employeesResult.rows) {
    const punchRows = punchesByEmp.get(employee.emp_id) || [];
    if (punchRows.length === 0) continue;

    const { totalWorkedMinutes, thresholdMinutes, otMinutes } = computeEmployeeDay({
      employee, date, punchRows, settingsMap, ramzanPeriods, defaultProject: null,
    });

    if (otMinutes > 0) {
      await ensureOtApproval({
        empId: employee.emp_id,
        date,
        workedMinutes: totalWorkedMinutes,
        thresholdMinutes,
        otMinutes,
        reportingManagerEmpId: employee.reporting_manager_emp_id,
      });
      created += 1;
    }
  }

  return { date, employeesEvaluated: employeesResult.rows.length, otApprovalsCreated: created };
}

module.exports = { runDailyOtJob };
