const pool = require('../db');
const { getAllSettings, parseRamzanPeriods } = require('./settings');

/**
 * Punch type (IN/OUT) is never stored — it's derived here, at calculation
 * time, from punch_time ordering within an (emp_id, project_code, day)
 * group: earliest = IN, latest = OUT (First-In-Last-Out). A group with
 * only one punch is an incomplete session and raises a 'single_punch_only'
 * exception for supervisor review — but only for past days. A single punch
 * for today is normal and expected mid-day (the employee just hasn't
 * pressed Punch again to close that project yet), not an anomaly.
 *
 * Rejected punches are excluded — a supervisor rejection explicitly
 * invalidates that punch, so letting it stand in as an official IN/OUT
 * time would defeat the point of the approval workflow.
 */

const GLOBAL_DEFAULT_MINUTES = 510; // used only if overtime_threshold_minutes is somehow missing entirely
const RAMZAN_DEFAULT_MINUTES = 360; // used only if ramzan_working_hours_minutes is somehow missing entirely

function dateKey(punchTime) {
  return punchTime.toISOString().slice(0, 10);
}

/**
 * Returns the [start, end) instant bounds of a UTC calendar day as JS Date
 * objects. These must be used — never a plain 'YYYY-MM-DD' string cast to
 * ::date — when filtering punch_time by day in SQL. node-pg serializes a JS
 * Date bound to a "timestamp without time zone" column through the
 * process's local timezone (the same conversion applied when punch_time was
 * originally written from a JS Date), so comparing Date-to-Date stays
 * internally consistent. A bare date string bypasses that conversion
 * entirely and silently mis-buckets any punch within the local-offset
 * window of midnight (confirmed: a 23:00 UTC punch was excluded from its
 * own day using the ::date form, in an environment offset at UTC+3).
 */
function getUtcDayBounds(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
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
    const ramzanMinutes = settingsMap.ramzan_working_hours_minutes !== undefined
      ? Number(settingsMap.ramzan_working_hours_minutes)
      : RAMZAN_DEFAULT_MINUTES;
    return { minutes: ramzanMinutes, source: 'ramzan' };
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

/**
 * Nested-project time, within one employee's one day: if a project's entire
 * punch span (its own first-to-last) falls chronologically inside another
 * project's wider span, that inner project's counted time is subtracted
 * from the outer one's — otherwise the same stretch of time would be
 * double-counted as "worked" under two different projects at once. Can
 * nest more than two levels deep (a project nested inside a project that's
 * itself nested inside another).
 *
 * Only sessions with a real punch_in/punch_out pair participate — a
 * single-punch (incomplete) session has no span to nest or be nested by.
 *
 * Algorithm: for each session, find its *direct* parent — the smallest
 * span that strictly contains it (not the largest/outermost one, to avoid
 * double-subtracting a grandchild once via its parent and again via its
 * grandparent). Process sessions from smallest span to largest so every
 * child's counted_minutes is already resolved by the time its parent needs
 * it: counted_minutes = raw span minutes − sum of direct children's
 * (already-adjusted) counted_minutes.
 */
function applyNestedSubtraction(sessionsForDay) {
  const spans = sessionsForDay
    .filter((session) => !session.incomplete)
    .map((session) => ({
      session,
      startMs: session.punch_in.punch_time.getTime(),
      endMs: session.punch_out.punch_time.getTime(),
    }));

  const directParent = new Map();
  for (const candidate of spans) {
    let best = null;
    let bestLength = Infinity;
    for (const other of spans) {
      if (other === candidate) continue;
      const strictlyContains =
        other.startMs <= candidate.startMs &&
        candidate.endMs <= other.endMs &&
        (other.startMs < candidate.startMs || candidate.endMs < other.endMs);
      if (strictlyContains) {
        const length = other.endMs - other.startMs;
        if (length < bestLength) {
          bestLength = length;
          best = other;
        }
      }
    }
    directParent.set(candidate.session, best ? best.session : null);
  }

  const bySpanLengthAscending = [...spans].sort((a, b) => (a.endMs - a.startMs) - (b.endMs - b.startMs));
  const subtractionForParent = new Map();

  for (const { session, startMs, endMs } of bySpanLengthAscending) {
    const rawMinutes = Math.round((endMs - startMs) / 60000);
    const subtract = subtractionForParent.get(session) || 0;
    session.counted_minutes = Math.max(0, rawMinutes - subtract);

    const parent = directParent.get(session);
    session.nested_within = parent ? parent.project_code : null;
    if (parent) {
      subtractionForParent.set(parent, (subtractionForParent.get(parent) || 0) + session.counted_minutes);
    }
  }

  for (const session of sessionsForDay) {
    if (session.incomplete) {
      session.counted_minutes = null;
      session.nested_within = null;
    }
  }
}

// empId === null computes attendance across all employees at once (used by
// the backoffice Reports page) instead of one employee at a time. date, when
// given, scopes to just that UTC calendar day (via getUtcDayBounds, same
// convention as everywhere else) instead of the full punch history — used by
// the Reports page's "attendance for a specific date" view.
async function calculateAttendance(empId, date) {
  const params = [];
  let whereClause = "approval_status <> 'rejected'";
  if (empId) {
    params.push(empId);
    whereClause += ` AND emp_id = $${params.length}`;
  }
  if (date) {
    const { start, end } = getUtcDayBounds(date);
    params.push(start, end);
    whereClause += ` AND punch_time >= $${params.length - 1} AND punch_time < $${params.length}`;
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
    pool.query(
      `SELECT e."EmpId" AS emp_id, r.religion_name AS religion
       FROM employees e
       LEFT JOIN religions r ON e."EmpReligionId" = r.religion_code`
    ),
  ]);
  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const religionByEmpId = new Map(religionRows.rows.map((row) => [row.emp_id, row.religion]));
  const today = dateKey(new Date());

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

    if (incomplete && date !== today) {
      const raised = await raiseSinglePunchException(groupEmpId, projectCode, date, punchIn);
      if (raised) {
        exceptionsRaised.push(raised);
      }
    }

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
    });
  }

  const byEmpDay = new Map();
  for (const session of sessions) {
    const key = `${session.emp_id}|${session.date}`;
    if (!byEmpDay.has(key)) byEmpDay.set(key, []);
    byEmpDay.get(key).push(session);
  }
  for (const group of byEmpDay.values()) {
    applyNestedSubtraction(group);
  }

  for (const session of sessions) {
    const threshold = getEffectiveThreshold({
      religion: religionByEmpId.get(session.emp_id) ?? null,
      date: session.date,
      settingsMap,
      ramzanPeriods,
    });
    session.threshold_minutes = threshold.minutes;
    session.threshold_source = threshold.source;
    session.is_overtime = session.incomplete ? null : session.counted_minutes > threshold.minutes;
    session.overtime_minutes = session.incomplete ? null : Math.max(0, session.counted_minutes - threshold.minutes);
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { sessions, exceptionsRaised };
}

function calculateAttendanceForEmployee(empId, date) {
  return calculateAttendance(empId, date);
}

function calculateAttendanceForAllEmployees(date) {
  return calculateAttendance(null, date);
}

/**
 * Returns the project_code of the one project (if any) the employee has
 * left "open" on the given date — an odd punch count, meaning it hasn't
 * been closed with a matching punch yet. date is a 'YYYY-MM-DD' string;
 * bounds are computed via getUtcDayBounds (never SQL's CURRENT_DATE or a
 * ::date-cast string) so this can never disagree with dateKey()'s
 * UTC-based day boundary.
 */
async function getOpenProjectForDate(empId, date) {
  const { start, end } = getUtcDayBounds(date);

  const { rows } = await pool.query(
    `SELECT project_code, count(*)::int AS cnt
     FROM punches
     WHERE emp_id = $1 AND approval_status <> 'rejected'
       AND project_code IS NOT NULL
       AND punch_time >= $2 AND punch_time < $3
     GROUP BY project_code
     ORDER BY project_code`,
    [empId, start, end]
  );

  const open = rows.find((row) => row.cnt % 2 !== 0);
  return open ? open.project_code : null;
}

function getOpenProjectForToday(empId) {
  return getOpenProjectForDate(empId, dateKey(new Date()));
}

module.exports = {
  calculateAttendanceForEmployee,
  calculateAttendanceForAllEmployees,
  getOpenProjectForToday,
  getOpenProjectForDate,
  dateKey,
  getUtcDayBounds,
  getEffectiveThreshold,
  applyNestedSubtraction,
};
