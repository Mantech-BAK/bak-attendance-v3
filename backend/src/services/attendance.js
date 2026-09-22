const pool = require('../db');
const {
  getAllSettings, parseRamzanPeriods,
  parseSummerBanPeriods, isWithinSummerBan, getBahrainDateKey, getBahrainDayUtcBounds, getBanWindowUtcBounds,
} = require('./settings');

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

// Kept under this name since it's used pervasively throughout this file and
// its callers (routes/punches.js, punchValidation.js, otApprovals.js) — but
// as of the 2026-09-16 timezone audit this delegates to
// settings.js's getBahrainDateKey(), the canonical Asia/Riyadh "what day is
// it" function, rather than a raw UTC toISOString(). Previously this WAS
// raw-UTC, which silently disagreed with the real Bahrain calendar day for
// roughly 3 hours after Bahrain midnight (UTC's own day boundary falls at
// 03:00 Bahrain time) — confirmed to matter in practice, not just in
// theory: it shifted Shift Type Night/Regular attribution, the open/close
// conflict window, and the OT cron's "yesterday" by that same 3 hours.
function dateKey(punchTime) {
  return getBahrainDateKey(punchTime);
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
 * Returns the [start, end) instant bounds of a real Asia/Riyadh calendar day
 * (matching dateKey()'s own definition of where a day starts and ends) as
 * JS Date objects. These must be used — never a plain 'YYYY-MM-DD' string
 * cast to ::date, and never a UTC-day assumption — when filtering
 * punch_time by day in SQL. node-pg serializes a JS Date bound to a
 * "timestamp without time zone" column via the Date's own UTC value with no
 * session-timezone involved, so comparing Date-to-Date here stays correct
 * regardless of the DB session's timezone. A bare date string bypasses that
 * entirely and silently mis-buckets any punch within the offset window of
 * midnight (confirmed: a 23:00 UTC punch was excluded from its own day
 * using the ::date form, in an environment offset at UTC+3) — and prior to
 * the 2026-09-16 timezone audit, this function itself used a UTC day
 * boundary rather than Bahrain's, which is the same class of bug one layer
 * up: it agreed with dateKey() only because dateKey() was ALSO UTC-based
 * back then. Both are now Bahrain-based together.
 */
function getBahrainDayBounds(date) {
  return getBahrainDayUtcBounds(date);
}

// Pure calendar-date arithmetic (shift a 'YYYY-MM-DD' string by N whole
// days) — timezone-agnostic by construction: anchoring at UTC-midnight of
// the input date, shifting by whole UTC days, then reading the result back
// out via dateKey() (Bahrain-based) always lands on the same calendar date
// a human would expect, since UTC-midnight of any date is always still
// Bahrain 03:00 of that SAME calendar date, never the day before or after.
// No change needed here for the timezone audit — confirmed already correct.
function shiftDateString(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return dateKey(d);
}

/**
 * Fetches the punch rows needed to correctly build one calendar date's
 * sessions once a task's shift_type can attribute a session to its
 * punch-OUT date instead of its punch-IN date (2026-09-14, see
 * dailyConfirmation.js's attributionDateForSession) — a session can
 * therefore cross the literal day boundary this function is being asked
 * about, in either direction, depending on shift_type. Regular sessions
 * crossing midnight (attribute to punch-IN date) need to be found by a
 * report generated for the day AFTER they close; Night sessions (attribute
 * to punch-OUT date) need to be found by a report generated for the day
 * BEFORE they open. A ±1 day window around `date` covers both directions
 * for any normal-length shift.
 *
 * task_id-keyed punches (any real task) are fetched completely regardless
 * of date — safe because a task can never accumulate more than its 2
 * punches, ever (checkTaskPunchCap), so no width of window risks merging
 * unrelated sessions together. The department-default fallback (bare
 * project_code, no task_id — no shift_type concept applies to it, since
 * there's no task to hold one) has no such cap, so it deliberately stays
 * scoped to the exact literal day, unchanged from this app's original
 * behavior, to avoid conflating separate daily sessions across days.
 *
 * approvedOnly (default true, 2026-09-22 fix + 2026-09-22 correction) —
 * approval_status = 'approved' only when true, else the original broader
 * `<> 'rejected'` (approved OR still-pending; a rejected punch never counts
 * toward anything, either way). The DISPLAYED/persisted Confirmation Sheet
 * rows (dailyConfirmation.js) must stay approved-only — a row on the sheet
 * is supposed to mean a supervisor/admin has actually signed off on it, a
 * pending punch simply doesn't exist for report purposes yet.
 *
 * But OT DETECTION is a different question from "what does the sheet show"
 * — both the nightly cron (otApprovals.js's runDailyOtJob) and the
 * Confirmation Sheet's own "ensure a pending ot_approvals row exists" side
 * effect exist specifically to FLAG a likely-overtime day for a
 * supervisor/admin to go review — and reviewing is exactly how those
 * underlying punches get approved in the first place. Requiring them to
 * already be approved before OT is even detected is circular, and is
 * exactly what caused real, confirmed overtime to silently never get
 * flagged whenever approval happened to land after the nightly cron had
 * already run for that date (confirmed 2026-09-22 with real data: a fresh
 * 9-hour pending punch pair produced 0 ot_approvals created; approving the
 * same two punches and re-running the exact same job for the exact same
 * date then created 1). Both OT-detection call sites now explicitly pass
 * approvedOnly: false; only the sheet-row fetch keeps the default.
 */
async function fetchPunchRowsForDate(date, { approvedOnly = true } = {}) {
  const windowStart = getBahrainDayBounds(shiftDateString(date, -1)).start;
  const windowEnd = getBahrainDayBounds(shiftDateString(date, 1)).end;
  const { start: dayStart, end: dayEnd } = getBahrainDayBounds(date);
  const approvalClause = approvedOnly ? "approval_status = 'approved'" : "approval_status <> 'rejected'";

  const candidateResult = await pool.query(
    `SELECT id, emp_id, project_code, task_id, punch_time, out_remark, extra_ot_minutes, extra_ot_granted_by
     FROM punches
     WHERE ${approvalClause} AND punch_time >= $1 AND punch_time < $2
     ORDER BY emp_id, project_code, task_id, punch_time`,
    [windowStart, windowEnd]
  );

  const taskIds = [...new Set(candidateResult.rows.filter((r) => r.task_id !== null).map((r) => r.task_id))];
  const projectOnlyRows = candidateResult.rows.filter(
    (r) => r.task_id === null && r.punch_time >= dayStart && r.punch_time < dayEnd
  );

  let taskRows = candidateResult.rows.filter((r) => r.task_id !== null);
  if (taskIds.length > 0) {
    const completeTaskResult = await pool.query(
      `SELECT id, emp_id, project_code, task_id, punch_time, out_remark, extra_ot_minutes, extra_ot_granted_by
       FROM punches
       WHERE ${approvalClause} AND task_id = ANY($1)
       ORDER BY emp_id, project_code, task_id, punch_time`,
      [taskIds]
    );
    taskRows = completeTaskResult.rows;
  }

  return [...taskRows, ...projectOnlyRows];
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

// Minutes [startMs, endMs) overlaps the 12pm-4pm Asia/Riyadh Summer Ban
// window on punch_in's own local calendar date — 0 outright if that date
// isn't inside a declared, active period. Computed for EVERY session
// (regardless of its own Indoor/Outdoor flag) — an Indoor session's own raw
// overlap still needs to be known so an Outdoor PARENT's real exposure can
// be derived correctly, below. Assumes a session doesn't cross local
// midnight, same as every other same-day assumption already built into
// this file (checkOpenConflict already forces same-day open/close for
// anything live punching can still produce).
function computeSummerBanOverlapMinutes(startMs, endMs, summerBanPeriods) {
  const localDate = getBahrainDateKey(new Date(startMs));
  if (!isWithinSummerBan(localDate, summerBanPeriods)) return 0;

  const { start: banStart, end: banEnd } = getBanWindowUtcBounds(localDate);
  const overlapStart = Math.max(startMs, banStart.getTime());
  const overlapEnd = Math.min(endMs, banEnd.getTime());
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
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
 *
 * Summer Ban subtraction (2026-09-14) is computed in this SAME bottom-up
 * pass, not as a separate before/after step — deliberately: a naive "if
 * Outdoor and the raw span straddles 12-4pm, subtract 240 minutes" is only
 * correct for a session with no nested children. If an Indoor child (never
 * itself blocked from punching inside 12-4pm, per rule 3) is nested inside
 * an Outdoor parent and happens to overlap the ban window, that slice of
 * the window was already carved out of the parent's counted time by the
 * ordinary nested-subtraction above — flatly subtracting the parent's full
 * raw overlap on top would double-remove it. So each session's raw
 * ban-window overlap is propagated to its direct parent exactly the way
 * counted_minutes itself is (parent's real overlap = parent's raw overlap
 * − Σ direct children's raw overlap), and the actual subtraction from
 * counted_minutes only ever applies to sessions whose OWN task is flagged
 * Outdoor. Because Outdoor tasks can never have a punch land inside
 * 12-4pm at all (rule 4 blocks it at write time), an Outdoor session's own
 * raw overlap is always exactly 0 or the full 240 minutes — never partial;
 * only an Indoor session (as a nested child) can contribute a partial
 * value into this propagation.
 */
function applyNestedSubtraction(sessionsForDay, { isOutdoorByTaskId = new Map(), summerBanPeriods = [] } = {}) {
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
  const banOverlapSubtractionForParent = new Map();

  for (const { session, startMs, endMs } of bySpanLengthAscending) {
    const rawMinutes = Math.round((endMs - startMs) / 60000);
    const subtract = subtractionForParent.get(session) || 0;
    session.counted_minutes = Math.max(0, rawMinutes - subtract);

    const rawBanOverlapMinutes = computeSummerBanOverlapMinutes(startMs, endMs, summerBanPeriods);
    const childBanOverlapSubtract = banOverlapSubtractionForParent.get(session) || 0;
    const netBanOverlapMinutes = Math.max(0, rawBanOverlapMinutes - childBanOverlapSubtract);

    const isOutdoor = isOutdoorByTaskId.get(session.task_id) === true;
    session.summer_ban_minutes_subtracted = isOutdoor ? netBanOverlapMinutes : 0;
    if (isOutdoor && netBanOverlapMinutes > 0) {
      session.counted_minutes = Math.max(0, session.counted_minutes - netBanOverlapMinutes);
    }

    const parent = directParent.get(session);
    session.nested_within = parent ? punchKey(parent.task_id, parent.project_code) : null;
    if (parent) {
      // session.counted_minutes already reflects this session's own ban
      // subtraction (applied just above) — a child's REAL worked time
      // (post-ban) is what's genuinely "claimed" from the parent's raw
      // span, so propagating anything else here would double-subtract.
      subtractionForParent.set(parent, (subtractionForParent.get(parent) || 0) + session.counted_minutes);
      // Separately, the ban-OVERLAP (not counted-minutes) propagation
      // tracks each session's raw overlap with the window regardless of
      // its own Indoor/Outdoor status — this is what lets an Outdoor
      // PARENT compute its own real exposure net of whatever a nested
      // child (Indoor or Outdoor) already occupied inside that window.
      banOverlapSubtractionForParent.set(parent, (banOverlapSubtractionForParent.get(parent) || 0) + rawBanOverlapMinutes);
    }
  }

  for (const session of sessionsForDay) {
    if (session.incomplete) {
      session.counted_minutes = null;
      session.nested_within = null;
      session.summer_ban_minutes_subtracted = null;
    }
  }
}

// empId === null computes attendance across all employees at once (used by
// the backoffice Reports page) instead of one employee at a time. date, when
// given, scopes to just that Bahrain calendar day (via getBahrainDayBounds, same
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
    const { start, end } = getBahrainDayBounds(date);
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

  const taskIds = [...new Set(rows.map((r) => r.task_id).filter((id) => id !== null))];

  const [settingsMap, religionRows, taskRows] = await Promise.all([
    getAllSettings(),
    pool.query(
      `SELECT e."EmpId" AS emp_id, r.religion_name AS religion, e."EmpOtStatus" AS ot_eligible
       FROM employees e
       LEFT JOIN religions r ON e."EmpReligionId" = r.religion_code`
    ),
    taskIds.length > 0
      ? pool.query('SELECT id, is_outdoor FROM tasks WHERE id = ANY($1)', [taskIds])
      : Promise.resolve({ rows: [] }),
  ]);
  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const summerBanPeriods = parseSummerBanPeriods(settingsMap);
  const isOutdoorByTaskId = new Map(taskRows.rows.map((row) => [row.id, row.is_outdoor === true]));
  const religionByEmpId = new Map(religionRows.rows.map((row) => [row.emp_id, row.religion]));
  // is_overtime/overtime_minutes below must never surface for a
  // non-OT-eligible employee, however many minutes over threshold they
  // worked — this was missing entirely (every session got flagged purely
  // on minutes, regardless of EmpOtStatus), the same class of bug as the
  // day-level ot_approvals eligibility check this mirrors.
  const otEligibleByEmpId = new Map(religionRows.rows.map((row) => [row.emp_id, row.ot_eligible === true]));
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
    applyNestedSubtraction(group, { isOutdoorByTaskId, summerBanPeriods });
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
    const otEligible = otEligibleByEmpId.get(session.emp_id) ?? false;
    session.is_overtime = session.incomplete || !otEligible ? null : session.counted_minutes > threshold.minutes;
    session.overtime_minutes = session.incomplete || !otEligible ? null : Math.max(0, session.counted_minutes - threshold.minutes);
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
 * any) the employee has left "open": an odd punch count within its
 * punchKey() group, meaning it hasn't been closed with a matching punch
 * yet. Purely a lookup — the actual policy of what punching something else
 * while this is open should do (block it) lives in checkOpenConflict
 * (punchValidation.js), which currently enforces a global "only one thing
 * open at a time" rule: punching anything other than this exact open
 * task/project is rejected, no same-project exception.
 *
 * A real task's own open/closed state (2026-09-14) is checked with NO date
 * filter at all, regardless of what `date` is passed — a task can never
 * accumulate more than its 2 punches, ever (checkTaskPunchCap), so "is this
 * task currently open" has one unambiguous answer independent of which
 * calendar day either punch happens to fall on. This is what makes a
 * genuine overnight Night-shift session (see shift_type) actually
 * closeable: checking task 21's open-ness scoped to the CLOSING punch's own
 * date (as this used to do) could never find an opening punch dated the
 * day before, permanently blocking that session from ever being closed.
 * The department-default fallback (bare project_code, no task_id — no
 * shift_type concept applies to it) has no such cap, so it deliberately
 * stays scoped to the exact literal `date` via getBahrainDayBounds, unchanged
 * from this app's original behavior, to avoid conflating separate daily
 * cycles together.
 */
async function getOpenPunchForDate(empId, date, excludePunchId) {
  const excludeClause = excludePunchId ? ' AND id != $2' : '';
  const taskParams = excludePunchId ? [empId, excludePunchId] : [empId];
  const taskResult = await pool.query(
    `SELECT task_id, count(*)::int AS cnt
     FROM punches
     WHERE emp_id = $1 AND approval_status <> 'rejected' AND task_id IS NOT NULL${excludeClause}
     GROUP BY task_id`,
    taskParams
  );
  const openTask = taskResult.rows.find((row) => row.cnt % 2 !== 0);
  if (openTask) return { task_id: openTask.task_id, project_code: null };

  const { start, end } = getBahrainDayBounds(date);
  const projectParams = excludePunchId ? [empId, start, end, excludePunchId] : [empId, start, end];
  const projectResult = await pool.query(
    `SELECT project_code, count(*)::int AS cnt
     FROM punches
     WHERE emp_id = $1 AND approval_status <> 'rejected' AND task_id IS NULL AND project_code IS NOT NULL
       AND punch_time >= $2 AND punch_time < $3${excludePunchId ? ' AND id != $4' : ''}
     GROUP BY project_code`,
    projectParams
  );
  const openProject = projectResult.rows.find((row) => row.cnt % 2 !== 0);
  return openProject ? { task_id: null, project_code: openProject.project_code } : null;
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
  getBahrainDayBounds,
  fetchPunchRowsForDate,
  getEffectiveThreshold,
  applyNestedSubtraction,
  buildSessionFromPunches,
  syncTaskSinglePunchException,
  resolveSinglePunchException,
};
