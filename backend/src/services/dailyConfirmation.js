const pool = require('../db');
const { getAllSettings, parseRamzanPeriods, parseSummerBanPeriods } = require('./settings');
const {
  getEffectiveThreshold, applyNestedSubtraction, punchKey, buildSessionFromPunches,
  dateKey, fetchPunchRowsForDate,
} = require('./attendance');
const { getDefaultProjectByEmpIdMap } = require('./tasks');

// Shortfall row's project when the employee's department has no default
// project configured — literal placeholder text, per product spec
// (2026-09-24), replacing the old "UNASSIGNED — no default project
// configured" wording.
const NO_DEFAULT_PROJECT_CODE = '000';
const NO_DEFAULT_PROJECT_NAME = 'Default Project';
const DEFAULT_MAX_OT_MINUTES = 600; // 10 hours, used only if max_ot_minutes is somehow missing

// Every OT display surface (mobile OvertimeApprovalsCard, backoffice
// Dashboard Overtime Alerts, backoffice ApprovalsPage) rounds ot hours to
// one decimal place, so any excess under 3 minutes (0.05h) renders as a
// misleading "+0.0h overtime"/"0h OT" — a real but practically-invisible
// amount that still shows up as something a supervisor has to act on.
// Confirmed in production: E1001 on 2026-08-20 worked 511 minutes against a
// 510-minute threshold — a genuine 1-minute excess that both the mobile and
// backoffice cards displayed as "0.0h"/"0h". Below this floor, OT is
// treated as punch-timing noise, not real overtime — no OT row, no
// ot_approvals record, ever created for it.
const MIN_OT_MINUTES = 3;

// OT over this many minutes is shown on the sheet as "3hrs or more, approved by
// <name>" instead of its exact clock timings (2026-09-24).
const OT_LONG_THRESHOLD_MINUTES = 180;

// Same floor for the shortfall row (2026-09-24) — a shortfall under this is
// punch-timing/rounding noise, not a real gap worth a row.
const MIN_SHORTFALL_MINUTES = 3;

// Matches confirmationSheetExcel.js's own REPORT_TIME_ZONE — REMARKS is
// human-readable business text (e.g. "OT: 5:00 PM - 7:00 PM"), so it needs
// the same timezone-aware formatting the rest of the sheet uses, not the
// raw UTC instant.
const REPORT_TIME_ZONE = 'Asia/Riyadh';

function formatHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

function formatDurationShort(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Summer Ban transparency note (2026-09-14) — session.summer_ban_minutes_subtracted
// is only ever non-zero for an Outdoor task's own row (applyNestedSubtraction
// in attendance.js already gates it that way), so this never needs its own
// Indoor/Outdoor check.
function appendSummerBanNote(remarks, session) {
  if (!session.summer_ban_minutes_subtracted) return remarks;
  const note = `Summer Ban: -${formatDurationShort(session.summer_ban_minutes_subtracted)} subtracted (12pm-4pm)`;
  return remarks ? `${remarks}. ${note}` : note;
}

function formatClockTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: REPORT_TIME_ZONE });
}

// Groups one employee's punches for one day into per-task sessions
// (First-In-Last-Out), with nested-subtraction already applied — mirrors
// calculateAttendance()'s grouping but scoped to a single employee/day.
// Grouped by punchKey(task_id, project_code) — task_id when the punch is
// against a real task, else project_code for the department-default
// fallback — so two different tasks sharing the same project become two
// independent sessions with their own real, separately calculated time
// (item 4), not merged into one.
// Which report date a session belongs on (2026-09-14) — Regular (the
// default, and the only concept that existed before this feature) always
// uses the punch-IN date; Night uses the punch-OUT date instead. An
// incomplete (still-open) session has no OUT date to use yet regardless of
// shift_type, so it provisionally shows under its punch-IN date — once it
// closes, a LATER report run for the real OUT date picks it up correctly
// (this app never retroactively rewrites an already-generated date, same as
// every other setting/period change here). Only a real task can have a
// shift_type at all; the department-default fallback (task_id null) is
// always IN-date, same as it always was.
function attributionDateForSession(session, shiftTypeByTaskId) {
  if (session.incomplete) {
    return dateKey(session.punch_in.punch_time);
  }
  const shiftType = session.task_id != null ? (shiftTypeByTaskId.get(session.task_id) || 'regular') : 'regular';
  return shiftType === 'night' ? dateKey(session.punch_out.punch_time) : dateKey(session.punch_in.punch_time);
}

function buildSessionsForDay(punchRows, empId, date, { isOutdoorByTaskId, summerBanPeriods, shiftTypeByTaskId = new Map() }) {
  const groups = new Map();
  for (const row of punchRows) {
    const key = punchKey(row.task_id, row.project_code);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  const sessions = [];
  for (const punches of groups.values()) {
    const { punchIn, punchOut, incomplete, workedMinutes, punchCount } = buildSessionFromPunches(punches);

    sessions.push({
      emp_id: empId,
      project_code: punchIn.project_code,
      task_id: punchIn.task_id,
      date,
      punch_count: punchCount,
      punch_in: { id: punchIn.id, punch_time: punchIn.punch_time },
      punch_out: punchOut
        ? {
            id: punchOut.id,
            punch_time: punchOut.punch_time,
            out_remark: punchOut.out_remark,
            extra_ot_minutes: punchOut.extra_ot_minutes ?? null,
            extra_ot_granted_by: punchOut.extra_ot_granted_by ?? null,
          }
        : null,
      incomplete,
      worked_minutes: workedMinutes,
    });
  }

  // Nested-subtraction must see every session that overlaps in real time —
  // including one that (per shift_type) will end up attributed to a
  // different report date than `date` — BEFORE the attribution filter below
  // removes it, so a cross-midnight parent's counted_minutes still nets
  // correctly against a same-time nested child regardless of which date
  // each one is ultimately reported under.
  applyNestedSubtraction(sessions, { isOutdoorByTaskId, summerBanPeriods });

  return sessions.filter((session) => attributionDateForSession(session, shiftTypeByTaskId) === date);
}

/**
 * Computes one employee's one-day confirmation-sheet rows: real per-task
 * rows only (nested-subtraction already applied — two tasks sharing a
 * project are two separate rows with independently calculated real time).
 *
 * Every gap between two sequential top-level sessions — regardless of
 * magnitude, 5 minutes or 5 hours — becomes its OWN "Travelling Time" row
 * between the two task rows (2026-09-15, reversing the previous 2026-08-30
 * behavior of folding it into the PRECEDING task's row). It carries the
 * SECOND task's project code/name (the travel is generally understood as
 * being incurred on the way TO the next task), both its TASK NAME and
 * Remarks columns literally "Travelling Time", and the gap's own duration
 * as its own counted working hours — no length threshold, same as before.
 * A non-positive gap (overlapping/adjacent punches) still produces nothing.
 *
 * For OT-eligible employees whose true worked time exceeds the day's
 * threshold, OT is shown directly on the day's last real row — its own OT
 * column populated with however many minutes (capped at max_ot_minutes)
 * were worked beyond the threshold, carrying the actual clock time range
 * the overtime occurred in (the tail end of that row's own session,
 * working backward by otMinutes) in REMARKS, with the true uncapped excess
 * also noted there for transparency. This is the SAME row as the task's
 * normal entry, never a second synthetic row for the same task/time
 * (2026-08-30 fix — it used to push a duplicate row purely to carry OT).
 *
 * Deliberately does NOT synthesize an absentee row or a shortfall row —
 * those were removed from the report by design (2026-08-20): the sheet
 * should only ever show real punch-backed activity, never fabricated
 * padding. Callers must pre-filter out employees with zero punches (see
 * generateConfirmationSheetRows and otApprovals.js) rather than rely on
 * this function to represent absence.
 */
function computeEmployeeDay({
  employee, date, punchRows, settingsMap, ramzanPeriods, isOutdoorByTaskId, summerBanPeriods, shiftTypeByTaskId,
  sourceByTaskId = new Map(),
}) {
  const threshold = getEffectiveThreshold({
    religion: employee.religion,
    date,
    settingsMap,
    ramzanPeriods,
  });
  const maxOtMinutes = settingsMap.max_ot_minutes !== undefined
    ? Number(settingsMap.max_ot_minutes)
    : DEFAULT_MAX_OT_MINUTES;

  const sessions = buildSessionsForDay(punchRows, employee.emp_id, date, { isOutdoorByTaskId, summerBanPeriods, shiftTypeByTaskId });
  const complete = sessions.filter((s) => !s.incomplete);
  const incompleteSessions = sessions.filter((s) => s.incomplete);
  const topLevel = complete
    .filter((s) => s.nested_within === null)
    .sort((a, b) => a.punch_in.punch_time - b.punch_in.punch_time);
  const nested = complete.filter((s) => s.nested_within !== null);

  const rows = [];
  let totalWorkedMinutes = 0;
  let lastTopLevelRow = null;

  for (let i = 0; i < topLevel.length; i++) {
    const session = topLevel[i];

    // Summer Ban note (2026-09-14) — transparency for a real payroll-
    // adjacent deduction. Only ever set on an Outdoor task's own row.
    const remarks = appendSummerBanNote('', session);

    totalWorkedMinutes += session.counted_minutes;

    const row = {
      project_code: session.project_code,
      project_name: null, // filled in by the caller, which has the projects lookup
      task_id: session.task_id,
      cost_center: null,
      start_time: session.punch_in.punch_time,
      end_time: session.punch_out.punch_time,
      working_minutes: session.counted_minutes,
      remarks,
      out_remark: session.punch_out.out_remark ?? null,
      is_ot_row: false,
      ot_minutes: 0,
      _extraOtMinutes: session.punch_out.extra_ot_minutes,
      _extraOtGrantedBy: session.punch_out.extra_ot_granted_by,
    };
    rows.push(row);
    lastTopLevelRow = row;

    if (i < topLevel.length - 1) {
      const next = topLevel[i + 1];
      const gapMinutes = Math.round((next.punch_in.punch_time - session.punch_out.punch_time) / 60000);

      // Every gap, any length, becomes its own "Travelling Time" row — no
      // gap-length threshold (2026-09-15). A non-positive gap (overlapping/
      // adjacent punches) still produces nothing, same as before.
      //
      // Emergency tasks (source 'employee_self') get NO special treatment
      // here anymore (2026-09-23, final word after this rule flip-flopped
      // several times in one day — 2026-09-15 attributed the gap to the
      // department default, 2026-09-17 omitted it entirely, this reverts
      // to plain equal treatment): a gap next to an emergency task is
      // exactly the same Travelling Time row a gap next to an
      // admin/supervisor-planned task gets — same project attribution
      // (the next session's), same label, same contribution to the day's
      // total worked minutes. sourceByTaskId is still threaded through
      // (other callers/behavior may still need it) but is no longer
      // consulted by this block at all.
      if (gapMinutes > 0) {
        totalWorkedMinutes += gapMinutes;
        rows.push({
          project_code: next.project_code,
          project_name: null, // filled in by the caller, same as any other row
          task_id: null,
          cost_center: null,
          start_time: session.punch_out.punch_time,
          end_time: next.punch_in.punch_time,
          working_minutes: gapMinutes,
          remarks: 'Travelling Time',
          out_remark: 'Travelling Time',
          is_ot_row: false,
          ot_minutes: 0,
        });
      }
    }
  }

  for (const session of nested) {
    totalWorkedMinutes += session.counted_minutes;
    rows.push({
      project_code: session.project_code,
      project_name: null,
      task_id: session.task_id,
      cost_center: null,
      start_time: session.punch_in.punch_time,
      end_time: session.punch_out.punch_time,
      working_minutes: session.counted_minutes,
      remarks: appendSummerBanNote('', session),
      out_remark: session.punch_out.out_remark ?? null,
      is_ot_row: false,
      ot_minutes: 0,
      _extraOtMinutes: session.punch_out.extra_ot_minutes,
      _extraOtGrantedBy: session.punch_out.extra_ot_granted_by,
    });
  }

  for (const session of incompleteSessions) {
    rows.push({
      project_code: session.project_code,
      project_name: null,
      task_id: session.task_id,
      cost_center: null,
      start_time: session.punch_in.punch_time,
      end_time: null,
      working_minutes: 0,
      remarks: 'Incomplete session — only one punch recorded',
      out_remark: null,
      is_ot_row: false,
      ot_minutes: 0,
    });
  }

  const trueExcessMinutes = Math.max(0, totalWorkedMinutes - threshold.minutes);
  let otMinutes = 0;

  // A shortfall (totalWorkedMinutes < threshold) no longer gets its own
  // padding row — the report now shows only real punch-backed rows,
  // whatever they add up to. Nothing else to do here in that case: no row,
  // no OT (trueExcessMinutes is 0 whenever there's a shortfall).
  // Admin-configured Minimum OT Threshold (Settings, 2026-09-24): OT below
  // it is skipped outright — no OT row here, hence no ot_approvals row from
  // either caller (the nightly cron and the sheet generator both act on
  // otMinutes). Never lower than the built-in MIN_OT_MINUTES noise floor;
  // unset/0 keeps today's behavior exactly.
  const configuredMinOt = Number(settingsMap.min_ot_threshold_minutes) || 0;
  const minOtMinutes = Math.max(MIN_OT_MINUTES, configuredMinOt);

  if (trueExcessMinutes >= minOtMinutes && employee.ot_eligible === 'Y') {
    otMinutes = Math.min(trueExcessMinutes, maxOtMinutes);
    const cappedNote = trueExcessMinutes > maxOtMinutes
      ? ` (true excess ${formatDurationShort(trueExcessMinutes)}, capped at ${formatDurationShort(maxOtMinutes)} for approval)`
      : '';
    const lastSession = topLevel[topLevel.length - 1];

    // OT is attributed to the tail end of the day's last session — working
    // backward from its actual punch-out by otMinutes — so the report shows
    // a real clock-time range ("OT: 5:00 PM - 7:00 PM"), not just a total.
    const otEnd = lastSession.punch_out.punch_time;
    const otStart = new Date(otEnd.getTime() - otMinutes * 60000);
    const timeRangeNote = `OT: ${formatClockTime(otStart)} - ${formatClockTime(otEnd)}`;

    // Populates the LAST TASK'S OWN ROW — tracked directly as
    // lastTopLevelRow while building rows above (a plain rows[topLevel.length
    // - 1] positional lookup no longer works now that a Travelling Time row
    // can sit between two topLevel rows in `rows`' construction order,
    // shifting later indices) — never a second row for the same task/time
    // (2026-08-30 fix; see computeEmployeeDay's docstring).
    lastTopLevelRow.ot_minutes = otMinutes;
    lastTopLevelRow._otTimeNote = timeRangeNote;
    lastTopLevelRow.is_ot_row = true;
    lastTopLevelRow.remarks = lastTopLevelRow.remarks
      ? `${lastTopLevelRow.remarks} ${timeRangeNote}${cappedNote}`
      : `${timeRangeNote}${cappedNote}`;
  }

  // Manual extra OT (2026-09-14) — granted by a supervisor/admin at the
  // moment they approved that specific session's closing punch (see
  // PATCH /api/punches/:id/approve). Purely additive on top of whatever the
  // automatic calculation above produced: independent of ot_eligible and
  // never capped by max_ot_minutes — a deliberate human grant, not the
  // automatic system's own determination. Attributed to the SAME row as the
  // punch it was granted on (topLevel or nested), not always the day's last
  // row, since the grant is tied to a specific session, not the whole day.
  for (const row of rows) {
    const extraOtMinutes = row._extraOtMinutes;
    if (extraOtMinutes) {
      row.ot_minutes += extraOtMinutes;
      row.is_ot_row = true;
      const grantNote = `+${formatDurationShort(extraOtMinutes)} manual OT granted${row._extraOtGrantedBy ? ` by ${row._extraOtGrantedBy}` : ''}`;
      row.remarks = row.remarks ? `${row.remarks} ${grantNote}` : grantNote;
      otMinutes += extraOtMinutes;
    }
    delete row._extraOtMinutes;
    delete row._extraOtGrantedBy;
  }

  return {
    rows, totalWorkedMinutes, thresholdMinutes: threshold.minutes, otMinutes, trueExcessMinutes,
    hasIncompleteSession: incompleteSessions.length > 0,
  };
}

/**
 * Persists one finalized confirmation-sheet row into confirmation_sheet_records
 * — BAK's own real-format output table, distinct from the on-demand Excel
 * export. Upserted on (EmpId, AttendanceDate, ProjectId, StartTime) so
 * re-generating the report for an already-persisted date updates existing
 * records instead of duplicating them. Postgres treats NULL as never equal
 * to NULL in a unique constraint, so an untimed row would never actually
 * conflict on a true NULL StartTime — every real (non-incomplete) row
 * carries a real start_time, so this fallback is only a defensive
 * backstop, not something any current row shape actually relies on.
 */
async function persistConfirmationSheetRecord(row) {
  const startTimeForKey = row.start_time || new Date(`${row.attendance_date}T00:00:00.000Z`);

  await pool.query(
    `INSERT INTO confirmation_sheet_records
       ("EmpId", "CPR", "EmpName", "Designation", "CostCenter", "AttendanceDate", "ProjectId", "ProjectName",
        "StartDate", "StartTime", "EndDate", "EndTime", "TotalWorkingHours", "OverTime", "Remarks", "ApprovedBy")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT ("EmpId", "AttendanceDate", "ProjectId", "StartTime") DO UPDATE SET
       "CPR" = EXCLUDED."CPR",
       "EmpName" = EXCLUDED."EmpName",
       "Designation" = EXCLUDED."Designation",
       "CostCenter" = EXCLUDED."CostCenter",
       "ProjectName" = EXCLUDED."ProjectName",
       "StartDate" = EXCLUDED."StartDate",
       "EndDate" = EXCLUDED."EndDate",
       "EndTime" = EXCLUDED."EndTime",
       "TotalWorkingHours" = EXCLUDED."TotalWorkingHours",
       "OverTime" = EXCLUDED."OverTime",
       "Remarks" = EXCLUDED."Remarks",
       "ApprovedBy" = EXCLUDED."ApprovedBy"`,
    [
      row.emp_id, row.cpr, row.employee_name, row.designation, row.cost_center, row.attendance_date,
      row.job, row.project_name, row.start_date, startTimeForKey, row.end_date, row.end_time,
      row.working_hours, row.ot === '' ? null : row.ot, row.remarks, row.approved_by,
    ]
  );
}

async function ensureOtApproval({ empId, date, workedMinutes, thresholdMinutes, otMinutes, reportingManagerEmpId }) {
  await pool.query(
    `INSERT INTO ot_approvals (emp_id, work_date, worked_minutes, threshold_minutes, ot_minutes, reporting_manager_emp_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (emp_id, work_date) DO NOTHING`,
    [empId, date, workedMinutes, thresholdMinutes, otMinutes, reportingManagerEmpId]
  );
}

/**
 * Generates every confirmation-sheet row for every active employee who has
 * at least one real punch on this date — an employee with zero punches
 * doesn't appear in the report at all (2026-08-20 scope change: this report
 * shows real recorded activity only, never a fabricated absentee row).
 * Detecting OT here also ensures a pending ot_approvals row exists for that
 * employee/day — so generating the report for a date guarantees the
 * reporting manager sees it in Review Attendance, without waiting on the
 * nightly cron.
 */
async function generateConfirmationSheetRows(date) {
  const [settingsMap, employeesResult, projectsResult, tasksResult, otApprovalsResult, leaveReportsResult, defaultProjectByEmp] = await Promise.all([
    getAllSettings(),
    pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
              r.religion_name AS religion,
              CASE WHEN e."EmpOtStatus" THEN 'Y' ELSE 'N' END AS ot_eligible,
              e."EmpReportMgrId" AS reporting_manager_emp_id, e."EmpCpr" AS cpr
       FROM employees e
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN religions r ON e."EmpReligionId" = r.religion_code
       WHERE e."EmpStatus" = 'active' ORDER BY e."EmpId"`
    ),
    pool.query('SELECT project_code, project_name, cost_center FROM projects'),
    pool.query('SELECT id, display_id, description, is_outdoor, shift_type, source FROM tasks'),
    pool.query('SELECT emp_id, status, approved_by FROM ot_approvals WHERE work_date = $1', [date]),
    pool.query('SELECT emp_id, leave_type, remarks FROM leave_reports WHERE leave_date = $1', [date]),
    getDefaultProjectByEmpIdMap(),
  ]);

  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const summerBanPeriods = parseSummerBanPeriods(settingsMap);
  const projectsByCode = new Map(projectsResult.rows.map((p) => [p.project_code, p]));
  const tasksById = new Map(tasksResult.rows.map((t) => [t.id, t]));
  const isOutdoorByTaskId = new Map(tasksResult.rows.map((t) => [t.id, t.is_outdoor === true]));
  const shiftTypeByTaskId = new Map(tasksResult.rows.map((t) => [t.id, t.shift_type]));
  // Source per task — no longer consulted by computeEmployeeDay's gap
  // logic as of 2026-09-23 (emergency tasks get plain equal treatment
  // there now, see its own comment), but still threaded through/computed
  // here in case any other current or future logic needs it.
  const sourceByTaskId = new Map(tasksResult.rows.map((t) => [t.id, t.source]));
  const employeeNameById = new Map(employeesResult.rows.map((e) => [e.emp_id, e.name]));
  const otStatusByEmp = new Map(otApprovalsResult.rows.map((o) => [o.emp_id, { status: o.status, approvedBy: o.approved_by }]));

  // Widened beyond the literal day for shift_type attribution — see
  // fetchPunchRowsForDate's own doc comment (attendance.js) for exactly what
  // it fetches and why it's safe to widen for task-based punches but not the
  // department-default fallback.
  //
  // Two separate fetches, deliberately (2026-09-22 fix): the sheet's own
  // DISPLAYED rows must stay approved-only (default), but OT detection
  // (ensureOtApproval below) must see pending punches too — otherwise an
  // employee whose punches for the day simply haven't been approved YET
  // never gets flagged for real overtime at all, which is circular (review/
  // approval is how a flagged day gets approved in the first place). See
  // fetchPunchRowsForDate's own comment for the real-data confirmation.
  const [widenedPunchRows, otDetectionPunchRows] = await Promise.all([
    fetchPunchRowsForDate(date),
    fetchPunchRowsForDate(date, { approvedOnly: false }),
  ]);
  const punchesByEmp = new Map();
  for (const row of widenedPunchRows) {
    if (!punchesByEmp.has(row.emp_id)) punchesByEmp.set(row.emp_id, []);
    punchesByEmp.get(row.emp_id).push(row);
  }
  const otPunchesByEmp = new Map();
  for (const row of otDetectionPunchRows) {
    if (!otPunchesByEmp.has(row.emp_id)) otPunchesByEmp.set(row.emp_id, []);
    otPunchesByEmp.get(row.emp_id).push(row);
  }

  // Report Leave integration (2026-09-23): a reported leave for this date
  // gets its OWN row — blank in/out/hours, TASK NAME shows the leave type,
  // Remarks shows the leave's entered remarks — ADDED alongside whatever
  // real punch rows the employee also has that day, never replacing or
  // hiding them (explicitly confirmed: "leave + punches on the same day"
  // shows both, it doesn't take precedence). An employee with a leave but
  // zero punches that day still gets exactly this one row, which is why the
  // `punchRows.length === 0` skip below now also checks leavesByEmp.
  const leavesByEmp = new Map();
  for (const row of leaveReportsResult.rows) {
    if (!leavesByEmp.has(row.emp_id)) leavesByEmp.set(row.emp_id, []);
    leavesByEmp.get(row.emp_id).push(row);
  }

  const reportRows = [];
  let rowNumber = 1;

  for (const employee of employeesResult.rows) {
    const punchRows = punchesByEmp.get(employee.emp_id) || [];

    // OT detection runs independently of whether this employee has any
    // APPROVED punches yet (2026-09-22 fix) — previously this whole
    // per-employee block, OT detection included, was skipped outright
    // whenever punchRows (approved-only) was empty, so an employee whose
    // punches for the day were ALL still pending was never even considered
    // for OT, on top of the fetchPunchRowsForDate issue above. Uses its own
    // computeEmployeeDay call over the broader otPunchRows — never reused
    // for the sheet's own rows, which stay approved-only below.
    const otPunchRows = otPunchesByEmp.get(employee.emp_id) || [];
    if (otPunchRows.length > 0) {
      const otComputation = computeEmployeeDay({
        employee, date, punchRows: otPunchRows, settingsMap, ramzanPeriods, isOutdoorByTaskId, summerBanPeriods,
        shiftTypeByTaskId, sourceByTaskId,
      });
      if (otComputation.otMinutes > 0) {
        await ensureOtApproval({
          empId: employee.emp_id,
          date,
          workedMinutes: otComputation.totalWorkedMinutes,
          thresholdMinutes: otComputation.thresholdMinutes,
          otMinutes: otComputation.otMinutes,
          reportingManagerEmpId: employee.reporting_manager_emp_id,
        });
      }
    }

    const leaves = leavesByEmp.get(employee.emp_id) || [];

    if (punchRows.length === 0 && leaves.length === 0) continue;

    const computation = punchRows.length === 0 ? null : computeEmployeeDay({
      employee, date, punchRows, settingsMap, ramzanPeriods, isOutdoorByTaskId, summerBanPeriods, shiftTypeByTaskId,
      sourceByTaskId,
    });
    const rows = computation ? computation.rows : [];

    // Shortfall row (2026-09-24): only for an employee with at least one
    // real (approved) punch — zero punches still means no row at all — whose
    // real worked time (Travelling Time gaps included, they count as worked)
    // is below the day's effective minimum (Ramzan > daily override > global,
    // via computeEmployeeDay's getEffectiveThreshold). A same-day leave
    // report does NOT change this: the shortfall is based on real punch
    // hours only, and the leave row is a separate additive row.
    // Skipped when any session is still open/unpaired (single_punch_only's
    // territory — a missing closing punch, not a real attendance gap), and
    // when the gap is under MIN_SHORTFALL_MINUTES (rounding noise).
    const shortfallMinutes = computation ? computation.thresholdMinutes - computation.totalWorkedMinutes : 0;
    // rows.length > 0: fetchPunchRowsForDate widens to adjacent days, so an
    // employee can have punchRows yet no session actually attributed to THIS
    // date — that's effectively zero punches here, and gets no row.
    if (computation && rows.length > 0 && !computation.hasIncompleteSession && shortfallMinutes >= MIN_SHORTFALL_MINUTES) {
      // Starts at the day's latest real punch-out (Travelling Time rows and
      // nested/overlapping sessions included, so max over every row's end)
      // and runs for exactly the shortfall — always appended after the last
      // real activity; may cross midnight (end_date then rolls forward).
      const shortfallStart = new Date(Math.max(...rows.filter((r) => r.end_time).map((r) => new Date(r.end_time).getTime())));
      const defaultProject = defaultProjectByEmp.get(employee.emp_id);
      const projectRecord = defaultProject ? projectsByCode.get(defaultProject.project_code) : null;
      rows.push({
        project_code: defaultProject ? defaultProject.project_code : NO_DEFAULT_PROJECT_CODE,
        project_name: defaultProject ? defaultProject.project_name : NO_DEFAULT_PROJECT_NAME,
        task_id: null,
        cost_center: projectRecord ? projectRecord.cost_center : null,
        start_time: shortfallStart,
        end_time: new Date(shortfallStart.getTime() + shortfallMinutes * 60000),
        working_minutes: shortfallMinutes,
        remarks: `Shortfall — ${formatDurationShort(shortfallMinutes)} below the day's minimum of ${formatDurationShort(computation.thresholdMinutes)}`,
        out_remark: null,
        is_ot_row: false,
        ot_minutes: 0,
      });
    }

    // One row per reported leave (normally just one — an employee reports
    // at most one leave per day, but nothing here assumes that). Blank
    // start/end/hours, TASK NAME (remarks) is the leave type, Remarks
    // (out_remark) is the leave's own entered remarks — additive alongside
    // any real punch rows above, per the confirmed "show both" behavior.
    for (const leave of leaves) {
      rows.push({
        project_code: null,
        project_name: '',
        task_id: null,
        cost_center: null,
        start_time: null,
        end_time: null,
        working_minutes: 0,
        remarks: leave.leave_type,
        out_remark: leave.remarks || null,
        is_ot_row: false,
        ot_minutes: 0,
        is_leave_row: true,
      });
    }

    for (const row of rows) {
      if (row.project_code && row.project_name === null) {
        const project = projectsByCode.get(row.project_code);
        row.project_name = project ? project.project_name : row.project_code;
        row.cost_center = project ? project.cost_center : null;
      }
      // Distinguishes two rows that share a project but are different real
      // tasks (item 4) — prefixed onto whatever REMARKS this row already
      // has (a gap note, an OT range, or nothing).
      if (row.task_id) {
        const task = tasksById.get(row.task_id);
        if (task) {
          const taskNote = `Task ${task.display_id}${task.description ? ` — ${task.description}` : ''}`;
          row.remarks = row.remarks ? `${taskNote}. ${row.remarks}` : taskNote;
        }
      }
    }

    const timed = rows.filter((r) => r.start_time).sort((a, b) => a.start_time - b.start_time);
    const untimed = rows.filter((r) => !r.start_time);

    for (const row of [...timed, ...untimed]) {
      const otRecord = otStatusByEmp.get(employee.emp_id);
      const approvalRequired = row.is_ot_row ? (otRecord?.status ?? 'pending') === 'pending' : false;
      // Approved By has no meaning for ordinary project-session rows — only
      // the OT row has a per-day approval concept at all (ot_approvals),
      // and only once it's actually been approved.
      const approvedBy = row.is_ot_row && otRecord?.status === 'approved' ? otRecord.approvedBy : null;

      // Long OT (>3h): replace the exact "OT: 5:00 PM - 9:30 PM" timings with
      // "OT: 3hrs or more" plus who approved it (or that approval is still
      // pending). Only the auto-OT timing note is swapped — any other note
      // already in REMARKS (task, capped-excess, manual OT grant) is kept.
      if (row.is_ot_row && row._otTimeNote && row.ot_minutes > OT_LONG_THRESHOLD_MINUTES) {
        const approverName = approvedBy ? (employeeNameById.get(approvedBy) ?? approvedBy) : null;
        const longNote = approverName
          ? `OT: 3hrs or more, approved by ${approverName}`
          : `OT: 3hrs or more, approval pending`;
        row.remarks = row.remarks.replace(row._otTimeNote, longNote);
      }

      const reportRow = {
        rowNumber: rowNumber++,
        emp_id: employee.emp_id,
        cpr: employee.cpr,
        employee_name: employee.name,
        designation: employee.designation,
        cost_center: row.cost_center,
        attendance_date: date,
        // The session's own real calendar dates (2026-09-14) — independent
        // of attendance_date, which is which report `date` this row is
        // attributed under (punch-IN date for a Regular task, punch-OUT
        // date for Night — see attributionDateForSession). For a same-day
        // session these always coincide anyway; a cross-midnight one is
        // exactly where they now genuinely differ, and this must keep
        // showing the real dates the punches happened, per spec.
        start_date: row.start_time ? dateKey(row.start_time) : date,
        start_time: row.start_time,
        end_time: row.end_time,
        end_date: row.end_time ? dateKey(row.end_time) : null,
        working_hours: row.is_leave_row ? null : formatHours(row.working_minutes),
        job: row.project_code || '',
        project_name: row.project_name,
        remarks: row.remarks,
        out_remark: row.out_remark,
        ot_eligible: employee.ot_eligible,
        ot: row.is_ot_row ? formatHours(row.ot_minutes) : '',
        approval_required: approvalRequired ? 'Y' : 'N',
        approved_by: approvedBy,
      };

      reportRows.push(reportRow);
      await persistConfirmationSheetRecord(reportRow);
    }
  }

  return reportRows;
}

module.exports = { generateConfirmationSheetRows, computeEmployeeDay, buildSessionsForDay, ensureOtApproval };
