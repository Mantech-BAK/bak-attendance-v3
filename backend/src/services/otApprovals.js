const pool = require('../db');
const { getAllSettings, parseRamzanPeriods, parseSummerBanPeriods } = require('./settings');
const { dateKey, fetchPunchRowsForDate } = require('./attendance');
const { computeEmployeeDay, ensureOtApproval } = require('./dailyConfirmation');
const { getDefaultProjectByEmpIdMap } = require('./tasks');

// Real Bahrain calendar yesterday, via dateKey()'s now-Bahrain-based
// getBahrainDateKey (2026-09-16 timezone audit) — correct here specifically
// because Asia/Riyadh has no DST, so "24 real hours before this cron's own
// Asia/Riyadh-scheduled fire time" always lands on the same Bahrain
// calendar date shiftDateString(today, -1) would give.
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
  const [settingsMap, employeesResult, tasksResult, defaultProjectByEmpId] = await Promise.all([
    getAllSettings(),
    pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
              d.division_name AS company, e."EmpDeptId" AS department, r.religion_name AS religion,
              CASE WHEN e."EmpOtStatus" THEN 'Y' ELSE 'N' END AS ot_eligible,
              e."EmpReportMgrId" AS reporting_manager_emp_id
       FROM employees e
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN divisions d ON e."EmpDivision" = d.division_code
       LEFT JOIN religions r ON e."EmpReligionId" = r.religion_code
       WHERE e."EmpStatus" = 'active' AND e."EmpOtStatus" = true ORDER BY e."EmpId"`
    ),
    // 2026-09-14/15 — this job used to compute otMinutes with neither Summer
    // Ban, shift_type, nor the Travelling-Time/default-project gap handling
    // aware of each other at all, silently drifting from whatever the
    // on-demand Confirmation Sheet (generateConfirmationSheetRows, which
    // already had all three) would show for the same date. Brought in line
    // here too, same maps, same fetch helper, so the nightly sweep never
    // disagrees with an admin manually generating the report for that date.
    pool.query('SELECT id, is_outdoor, shift_type, source FROM tasks'),
    getDefaultProjectByEmpIdMap(),
  ]);
  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const summerBanPeriods = parseSummerBanPeriods(settingsMap);
  const isOutdoorByTaskId = new Map(tasksResult.rows.map((t) => [t.id, t.is_outdoor === true]));
  const shiftTypeByTaskId = new Map(tasksResult.rows.map((t) => [t.id, t.shift_type]));
  const sourceByTaskId = new Map(tasksResult.rows.map((t) => [t.id, t.source]));

  const widenedPunchRows = await fetchPunchRowsForDate(date);
  const punchesByEmp = new Map();
  for (const row of widenedPunchRows) {
    if (!punchesByEmp.has(row.emp_id)) punchesByEmp.set(row.emp_id, []);
    punchesByEmp.get(row.emp_id).push(row);
  }

  let created = 0;
  for (const employee of employeesResult.rows) {
    const punchRows = punchesByEmp.get(employee.emp_id) || [];
    if (punchRows.length === 0) continue;

    const { totalWorkedMinutes, thresholdMinutes, otMinutes } = computeEmployeeDay({
      employee, date, punchRows, settingsMap, ramzanPeriods, isOutdoorByTaskId, summerBanPeriods, shiftTypeByTaskId,
      sourceByTaskId, defaultProject: defaultProjectByEmpId.get(employee.emp_id) ?? null,
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
