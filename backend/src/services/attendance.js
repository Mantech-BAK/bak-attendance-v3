const pool = require('../db');
const { getAllSettings, parseRamzanPeriods } = require('./settings');

/**
 * Punch type (IN/OUT) is never stored — it's derived here, at calculation
 * time, from punch_time ordering within an (emp_id, project_code, day)
 * group: earliest = IN, latest = OUT (First-In-Last-Out). A group with
 * only one punch is an incomplete session and raises a 'single_punch_only'
 * exception for supervisor review.
 *
 * Rejected punches are excluded — a supervisor rejection explicitly
 * invalidates that punch, so letting it stand in as an official IN/OUT
 * time would defeat the point of the approval workflow.
 */

const GLOBAL_DEFAULT_MINUTES = 510; // used only if overtime_threshold_minutes is somehow missing entirely
const RAMZAN_THRESHOLD_MINUTES = 360; // fixed 6 hours

function dateKey(punchTime) {
  return punchTime.toISOString().slice(0, 10);
}

function isWithinRamzan(dateStr, ramzanPeriods) {
  return ramzanPeriods.some((period) => dateStr >= period.start_date && dateStr <= period.end_date);
}

/**
 * Precedence: a Muslim employee's date falling within a declared Ramzan
 * period always wins (fixed 6h), regardless of any daily override or the
 * global default. Otherwise: that day's daily_working_hours:<date> entry if
 * an admin set one, else the global overtime_threshold_minutes default.
 */
function getEffectiveThreshold({ religion, date, settingsMap, ramzanPeriods }) {
  if (religion === 'Muslim' && isWithinRamzan(date, ramzanPeriods)) {
    return { minutes: RAMZAN_THRESHOLD_MINUTES, source: 'ramzan' };
  }

  const dailyOverride = settingsMap[`daily_working_hours:${date}`];
  if (dailyOverride !== undefined) {
    return { minutes: Number(dailyOverride) * 60, source: 'daily_override' };
  }

  const globalMinutes = settingsMap.overtime_threshold_minutes !== undefined
    ? Number(settingsMap.overtime_threshold_minutes)
    : GLOBAL_DEFAULT_MINUTES;
  return { minutes: globalMinutes, source: 'global_default' };
}

async function raiseSinglePunchException(empId, projectCode, date, punch) {
  const existing = await pool.query(
    `SELECT id FROM exceptions
     WHERE type = 'single_punch_only' AND ref_table = 'punches' AND ref_id = $1 AND status = 'open'`,
    [punch.id]
  );
  if (existing.rows.length > 0) {
    return null;
  }

  const details = `Employee ${empId} has only one punch for project ${projectCode || 'unassigned'} on ${date} — session is incomplete.`;

  const result = await pool.query(
    `INSERT INTO exceptions (type, emp_id, ref_table, ref_id, details, status)
     VALUES ('single_punch_only', $1, 'punches', $2, $3, 'open')
     RETURNING id, type, emp_id, ref_table, ref_id, details, status, created_at`,
    [empId, punch.id, details]
  );

  return result.rows[0];
}

// empId === null computes attendance across all employees at once (used by
// the backoffice Reports page) instead of one employee at a time.
async function calculateAttendance(empId) {
  const params = [];
  let whereClause = "approval_status <> 'rejected'";
  if (empId) {
    whereClause += ' AND emp_id = $1';
    params.push(empId);
  }

  const { rows } = await pool.query(
    `SELECT id, emp_id, project_code, punch_time
     FROM punches
     WHERE ${whereClause}
     ORDER BY emp_id, project_code, punch_time`,
    params
  );

  const [settingsMap, religionRows] = await Promise.all([
    getAllSettings(),
    pool.query('SELECT emp_id, religion FROM employees'),
  ]);
  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const religionByEmpId = new Map(religionRows.rows.map((row) => [row.emp_id, row.religion]));

  const groups = new Map();
  for (const row of rows) {
    const date = dateKey(row.punch_time);
    const key = `${row.emp_id}|${row.project_code}|${date}`;
    if (!groups.has(key)) {
      groups.set(key, { empId: row.emp_id, projectCode: row.project_code, date, punches: [] });
    }
    groups.get(key).punches.push(row);
  }

  const sessions = [];
  const exceptionsRaised = [];

  for (const { empId: groupEmpId, projectCode, date, punches } of groups.values()) {
    const sorted = [...punches].sort((a, b) => a.punch_time - b.punch_time);
    const punchIn = sorted[0];
    const punchOut = sorted.length > 1 ? sorted[sorted.length - 1] : null;
    const incomplete = sorted.length === 1;

    if (incomplete) {
      const raised = await raiseSinglePunchException(groupEmpId, projectCode, date, punchIn);
      if (raised) {
        exceptionsRaised.push(raised);
      }
    }

    const threshold = getEffectiveThreshold({
      religion: religionByEmpId.get(groupEmpId) ?? null,
      date,
      settingsMap,
      ramzanPeriods,
    });
    const workedMinutes = incomplete ? null : Math.round((punchOut.punch_time - punchIn.punch_time) / 60000);

    sessions.push({
      emp_id: groupEmpId,
      project_code: projectCode,
      date,
      punch_count: sorted.length,
      punch_in: { id: punchIn.id, punch_time: punchIn.punch_time },
      punch_out: punchOut ? { id: punchOut.id, punch_time: punchOut.punch_time } : null,
      incomplete,
      worked_minutes: workedMinutes,
      threshold_minutes: threshold.minutes,
      threshold_source: threshold.source,
      is_overtime: incomplete ? null : workedMinutes > threshold.minutes,
      overtime_minutes: incomplete ? null : Math.max(0, workedMinutes - threshold.minutes),
    });
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { sessions, exceptionsRaised };
}

function calculateAttendanceForEmployee(empId) {
  return calculateAttendance(empId);
}

function calculateAttendanceForAllEmployees() {
  return calculateAttendance(null);
}

module.exports = { calculateAttendanceForEmployee, calculateAttendanceForAllEmployees };
