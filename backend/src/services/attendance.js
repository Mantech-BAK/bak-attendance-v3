const pool = require('../db');
const { getAllSettings, parseRamzanPeriods } = require('./settings');

/**
 * Punch type (IN/OUT) is never stored — it's derived here, at calculation
 * time, from punch_time ordering within an (emp_id, punch key, day) group:
 * earliest = IN, latest = OUT (First-In-Last-Out). A real task can never
 * accumulate more than its 2 punches (open + close — enforced at write time
 * by checkTaskPunchCap in punchValidation.js, which hard-blocks a 3rd), so
 * for task-based groups an odd count only ever means exactly 1: the task is
 * still Pending, its close punch hasn't happened yet. The department-default
 * fallback (no real task, keyed by bare project_code) has no such cap, so
 * buildSessionFromPunches below still treats ANY odd count as incomplete —
 * whatever punch closed the most recent open cycle is missing — rather than
 * assuming it can only be 1. Either way this raises a 'single_punch_only'
 * exception for supervisor review — but only for past days; an odd count
 * for TODAY is normal and expected mid-day (the employee just hasn't
 * pressed Punch again to close that task yet), not an anomaly. Once the
 * same group's count goes back to even (a matching close punch shows up,
 * e.g. via an admin correction), the exception auto-resolves on its own —
 * see raiseSinglePunchException/resolveSinglePunchException below.
 *
 * The "punch key" identifies what's actually being tracked: task_id when the
 * punch is against a real task, else project_code for the department-default
 * fallback (no real task assigned that day) — see punchKey() below. Two
 * different tasks sharing the same project are two independent keys, so they
 * get independently calculated real time instead of being merged.
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
 * The generalized identity a punch is tracked under: 'task:<id>' for a real
 * task, 'project:<code>' for the department-default fallback (task_id null).
 * Used everywhere two punches need to be compared for "is this the same
 * thing being punched" — grouping into sessions, the even/odd open check,
 * and the duplicate/cross-conflict checks in routes/punches.js.
 */
function punchKey(taskId, projectCode) {
  return taskId !== null && taskId !== undefined ? `task:${taskId}` : `project:${projectCode}`;
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

// A deactivated period (active === false) no longer applies to threshold
// calculations for any report generated after it was deactivated — already
// generated confirmation_sheet_records / ot_approvals rows are left exactly
// as they were (this app never retroactively recomputes on a settings
// change, same as every other setting).
function isWithinRamzan(dateStr, ramzanPeriods) {
  return ramzanPeriods.some(
    (period) => period.active !== false && dateStr >= period.start_date && dateStr <= period.end_date
  );
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

/**
 * Groups a punch group's raw rows into a session shape — shared by
 * calculateAttendance (this file) and dailyConfirmation.js's
 * buildSessionsForDay, so the two never drift on what "incomplete" means.
 * An ODD count (not just exactly one) is incomplete: the most recent open
 * cycle in the group has no matching close punch yet, so there's no real
 * punch_out — treating the last punch as if it closed the session would be
 * wrong (it's actually the dangling open one).
 */
function buildSessionFromPunches(punches) {
  const sorted = [...punches].sort((a, b) => a.punch_time - b.punch_time);
  const punchIn = sorted[0];
  const incomplete = sorted.length % 2 !== 0;
  const punchOut = incomplete ? null : sorted[sorted.length - 1];
  const workedMinutes = incomplete ? null : Math.round((punchOut.punch_time - punchIn.punch_time) / 60000);
  return { punchIn, punchOut, incomplete, workedMinutes, punchCount: sorted.length };
}

async function raiseSinglePunchException(empId, projectCode, date, punch, punchCount) {
  const existing = await pool.query(
    `SELECT id FROM exceptions
     WHERE type = 'single_punch_only' AND ref_table = 'punches' AND ref_id = $1 AND status = 'open'`,
    [punch.id]
  );
  if (existing.rows.length > 0) {
    return null;
  }

  const details = punchCount === 1
    ? `Employee ${empId} has a single punch for project ${projectCode || 'unassigned'} on ${date} — session is incomplete/still open.`
    : `Employee ${empId} has ${punchCount} punches (odd count) for project ${projectCode || 'unassigned'} on ${date} — session is incomplete/still open.`;

  const result = await pool.query(
    `INSERT INTO exceptions (type, emp_id, ref_table, ref_id, details, status)
     VALUES ('single_punch_only', $1, 'punches', $2, $3, 'open')
     RETURNING id, type, emp_id, ref_table, ref_id, details, status, created_at`,
    [empId, punch.id, details]
  );

  return result.rows[0];
}

// The reverse of raiseSinglePunchException — once the same group (identified
// by its stable first punch, which never changes as later punches are
// added) goes back to an even count, whatever open exception was raised
// for it no longer applies. Runs unconditionally alongside the raise check
// on every calculateAttendance call; matches 0 rows (and is a no-op) the
// vast majority of the time, same pattern as ensureOtApproval's
// ON CONFLICT DO NOTHING elsewhere in this app.
async function resolveSinglePunchException(punchId) {
  await pool.query(
    `UPDATE exceptions SET status = 'resolved'
     WHERE type = 'single_punch_only' AND ref_table = 'punches' AND ref_id = $1 AND status = 'open'`,
    [punchId]
  );
}

/**
 * Keeps a real task's single_punch_only exception in sync IMMEDIATELY at
 * punch write time, called directly from routes/punches.js — unlike the
 * department-default fallback (bare project_code, no task_id), which stays
 * on the older lazy path (only evaluated whenever calculateAttendance
 * happens to run for that employee/day, e.g. from the Reports page, and
 * only for days other than today — "employee's probably still mid-shift"
 * is a real ambiguity there), a real task's Pending/Completed state is now
 * a stable, well-defined thing the moment it's written: the 2-punch cap
 * (checkTaskPunchCap in punchValidation.js) makes "exactly 1 punch" a
 * genuine, permanent incomplete state for that task, not something that
 * might still resolve itself later today. So there's no reason to gate it
 * on the day rolling over or on an admin happening to open a report for
 * that date — the Exceptions page should reflect it the instant it's true.
 *
 * No-ops silently if the task has zero non-rejected punches (nothing to
 * flag). Callers are expected to also call resolveSinglePunchException with
 * a punch's own id first when that specific punch is being edited away from
 * or deleted out from under a task — this function only evaluates the
 * task's CURRENT punches, so it can't clean up an exception still
 * referencing a punch that no longer belongs to (or no longer exists on)
 * this task.
 */
async function syncTaskSinglePunchException(taskId) {
  const { rows } = await pool.query(
    `SELECT id, emp_id, project_code, task_id, punch_time
     FROM punches
     WHERE task_id = $1 AND approval_status <> 'rejected'`,
    [taskId]
  );
  if (rows.length === 0) return;

  const { punchIn, incomplete, punchCount } = buildSessionFromPunches(rows);
  const date = dateKey(punchIn.punch_time);

  if (incomplete) {
    await raiseSinglePunchException(punchIn.emp_id, punchIn.project_code, date, punchIn, punchCount);
  } else {
    await resolveSinglePunchException(punchIn.id);
  }
}

/**
 * Nested time, within one employee's one day: if one task/project's entire
 * punch span (its own first-to-last) falls chronologically inside another's
 * wider span, that inner one's counted time is subtracted from the outer
 * one's — otherwise the same stretch of time would be double-counted as
 * "worked" under two different things at once. Can nest more than two
 * levels deep.
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
    session.nested_within = parent ? punchKey(parent.task_id, parent.project_code) : null;
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
    `SELECT id, emp_id, project_code, task_id, punch_time
     FROM punches
     WHERE ${whereClause}
     ORDER BY emp_id, project_code, task_id, punch_time`,
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
    const key = `${row.emp_id}|${punchKey(row.task_id, row.project_code)}|${date}`;
    if (!groups.has(key)) {
      groups.set(key, { empId: row.emp_id, projectCode: row.project_code, taskId: row.task_id, date, punches: [] });
    }
    groups.get(key).punches.push(row);
  }

  const sessions = [];
  const exceptionsRaised = [];

  for (const { empId: groupEmpId, projectCode, taskId, date, punches } of groups.values()) {
    const { punchIn, punchOut, incomplete, workedMinutes, punchCount } = buildSessionFromPunches(punches);

    if (date !== today) {
      if (incomplete) {
        const raised = await raiseSinglePunchException(groupEmpId, projectCode, date, punchIn, punchCount);
        if (raised) {
          exceptionsRaised.push(raised);
        }
      } else {
        await resolveSinglePunchException(punchIn.id);
      }
    }

    sessions.push({
      emp_id: groupEmpId,
      project_code: projectCode,
      task_id: taskId,
      date,
      punch_count: punchCount,
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
 * Returns the identity — { task_id, project_code } — of the one thing (if
 * any) the employee has left "open" on the given date: an odd punch count
 * within its punchKey() group, meaning it hasn't been closed with a
 * matching punch yet. Purely a lookup — the actual policy of what punching
 * something else while this is open should do (block it) lives in
 * checkOpenConflict (punchValidation.js), which currently enforces a
 * global "only one thing open at a time" rule: punching anything other
 * than this exact open task/project is rejected, no same-project exception.
 *
 * date is a 'YYYY-MM-DD' string; bounds are computed via getUtcDayBounds
 * (never SQL's CURRENT_DATE or a ::date-cast string) so this can never
 * disagree with dateKey()'s UTC-based day boundary.
 */
async function getOpenPunchForDate(empId, date, excludePunchId) {
  const { start, end } = getUtcDayBounds(date);

  const params = [empId, start, end];
  let sql = `
    SELECT task_id, project_code, count(*)::int AS cnt
    FROM punches
    WHERE emp_id = $1 AND approval_status <> 'rejected'
      AND (task_id IS NOT NULL OR project_code IS NOT NULL)
      AND punch_time >= $2 AND punch_time < $3`;
  if (excludePunchId) {
    params.push(excludePunchId);
    sql += ` AND id != $${params.length}`;
  }
  sql += ' GROUP BY task_id, project_code';

  const { rows } = await pool.query(sql, params);

  const open = rows.find((row) => row.cnt % 2 !== 0);
  return open ? { task_id: open.task_id, project_code: open.project_code } : null;
}

function getOpenPunchForToday(empId) {
  return getOpenPunchForDate(empId, dateKey(new Date()));
}

module.exports = {
  calculateAttendanceForEmployee,
  calculateAttendanceForAllEmployees,
  getOpenPunchForToday,
  getOpenPunchForDate,
  punchKey,
  dateKey,
  getUtcDayBounds,
  getEffectiveThreshold,
  applyNestedSubtraction,
  buildSessionFromPunches,
  syncTaskSinglePunchException,
  resolveSinglePunchException,
};
