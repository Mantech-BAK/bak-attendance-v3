const pool = require('../db');
const { getAllSettings, parseRamzanPeriods } = require('./settings');
const { getEffectiveThreshold, applyNestedSubtraction, getUtcDayBounds, punchKey, buildSessionFromPunches } = require('./attendance');

// Gaps under this many minutes between two sequential top-level sessions fold
// into the preceding one's counted time (as part of that real row); gaps
// at or above it still count toward the day's worked total (same as ever —
// this feeds threshold/OT math shared with the nightly OT cron, see
// otApprovals.js), they just no longer get their own report row — see
// computeEmployeeDay's docstring for why.
const SMALL_GAP_THRESHOLD_MINUTES = 60;
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
function buildSessionsForDay(punchRows, empId, date) {
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
      punch_out: punchOut ? { id: punchOut.id, punch_time: punchOut.punch_time } : null,
      incomplete,
      worked_minutes: workedMinutes,
    });
  }

  applyNestedSubtraction(sessions);
  return sessions;
}

/**
 * Computes one employee's one-day confirmation-sheet rows: real per-task
 * rows only (nested-subtraction already applied — two tasks sharing a
 * project are two separate rows with independently calculated real time),
 * small gaps folded into the preceding session with a REMARKS note, and —
 * for OT-eligible employees whose true worked time exceeds the day's
 * threshold — an OT row (on their last real session) capped at
 * max_ot_minutes, carrying the actual clock time range the overtime
 * occurred in (the tail end of the last session, working backward by
 * otMinutes) rather than just a total, with the true uncapped excess noted
 * in REMARKS for transparency even though only the capped amount is ever
 * presented as approvable OT.
 *
 * Deliberately does NOT synthesize an absentee row, a shortfall row, or a
 * large-gap "attributed to default project" row — those were removed from
 * the report by design (2026-08-20): the sheet should only ever show real
 * punch-backed activity, never fabricated padding. Callers must pre-filter
 * out employees with zero punches (see generateConfirmationSheetRows and
 * otApprovals.js) rather than rely on this function to represent absence.
 *
 * The large-gap minutes still count toward totalWorkedMinutes exactly as
 * before, though — that arithmetic feeds threshold/OT detection shared with
 * the nightly OT cron (otApprovals.js), which this report-display change
 * must not affect.
 */
function computeEmployeeDay({ employee, date, punchRows, settingsMap, ramzanPeriods }) {
  const threshold = getEffectiveThreshold({
    religion: employee.religion,
    date,
    settingsMap,
    ramzanPeriods,
  });
  const maxOtMinutes = settingsMap.max_ot_minutes !== undefined
    ? Number(settingsMap.max_ot_minutes)
    : DEFAULT_MAX_OT_MINUTES;

  const sessions = buildSessionsForDay(punchRows, employee.emp_id, date);
  const complete = sessions.filter((s) => !s.incomplete);
  const incompleteSessions = sessions.filter((s) => s.incomplete);
  const topLevel = complete
    .filter((s) => s.nested_within === null)
    .sort((a, b) => a.punch_in.punch_time - b.punch_in.punch_time);
  const nested = complete.filter((s) => s.nested_within !== null);

  const rows = [];
  let totalWorkedMinutes = 0;

  for (let i = 0; i < topLevel.length; i++) {
    const session = topLevel[i];
    let extraMinutes = 0;
    let remarks = '';

    if (i < topLevel.length - 1) {
      const next = topLevel[i + 1];
      const gapMinutes = Math.round((next.punch_in.punch_time - session.punch_out.punch_time) / 60000);

      if (gapMinutes > 0 && gapMinutes < SMALL_GAP_THRESHOLD_MINUTES) {
        extraMinutes = gapMinutes;
        remarks = `Includes ${formatDurationShort(gapMinutes)} transition gap before the next project`;
      } else if (gapMinutes >= SMALL_GAP_THRESHOLD_MINUTES) {
        // No longer emits its own "attributed to default project" row (see
        // computeEmployeeDay's docstring) — but the gap still counts toward
        // totalWorkedMinutes, unchanged, since OT/threshold detection here
        // is shared with the nightly OT cron.
        totalWorkedMinutes += gapMinutes;
      }
    }

    const rowMinutes = session.counted_minutes + extraMinutes;
    totalWorkedMinutes += rowMinutes;

    rows.push({
      project_code: session.project_code,
      project_name: null, // filled in by the caller, which has the projects lookup
      task_id: session.task_id,
      cost_center: null,
      start_time: session.punch_in.punch_time,
      end_time: session.punch_out.punch_time,
      working_minutes: rowMinutes,
      remarks,
      is_ot_row: false,
    });
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
      remarks: '',
      is_ot_row: false,
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
      is_ot_row: false,
    });
  }

  const trueExcessMinutes = Math.max(0, totalWorkedMinutes - threshold.minutes);
  let otMinutes = 0;

  // A shortfall (totalWorkedMinutes < threshold) no longer gets its own
  // padding row — the report now shows only real punch-backed rows,
  // whatever they add up to. Nothing else to do here in that case: no row,
  // no OT (trueExcessMinutes is 0 whenever there's a shortfall).
  if (trueExcessMinutes >= MIN_OT_MINUTES && employee.ot_eligible === 'Y') {
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

    rows.push({
      project_code: lastSession.project_code,
      project_name: null,
      task_id: lastSession.task_id,
      cost_center: null,
      start_time: otStart,
      end_time: otEnd,
      working_minutes: otMinutes,
      remarks: `${timeRangeNote}${cappedNote}`,
      is_ot_row: true,
    });
  }

  return { rows, totalWorkedMinutes, thresholdMinutes: threshold.minutes, otMinutes, trueExcessMinutes };
}

/**
 * Persists one finalized confirmation-sheet row into confirmation_sheet_records
 * — BAK's own real-format output table, distinct from the on-demand Excel
 * export. Upserted on (EmpId, AttendanceDate, ProjectId, StartTime) so
 * re-generating the report for an already-persisted date updates existing
 * records instead of duplicating them. Postgres treats NULL as never equal
 * to NULL in a unique constraint, so an untimed row would never actually
 * conflict on a true NULL StartTime — every row now carries a real
 * start_time (even the OT row, since item 8 gave it a real clock-time
 * range), so this fallback is now only a defensive backstop, not something
 * any current row shape actually relies on.
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
  const [settingsMap, employeesResult, projectsResult, tasksResult, otApprovalsResult] = await Promise.all([
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
    pool.query('SELECT id, display_id, description FROM tasks'),
    pool.query('SELECT emp_id, status, approved_by FROM ot_approvals WHERE work_date = $1', [date]),
  ]);

  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const projectsByCode = new Map(projectsResult.rows.map((p) => [p.project_code, p]));
  const tasksById = new Map(tasksResult.rows.map((t) => [t.id, t]));
  const otStatusByEmp = new Map(otApprovalsResult.rows.map((o) => [o.emp_id, { status: o.status, approvedBy: o.approved_by }]));

  const { start, end } = getUtcDayBounds(date);
  const punchesResult = await pool.query(
    `SELECT id, emp_id, project_code, task_id, punch_time
     FROM punches
     WHERE approval_status <> 'rejected'
       AND punch_time >= $1 AND punch_time < $2
     ORDER BY emp_id, project_code, task_id, punch_time`,
    [start, end]
  );
  const punchesByEmp = new Map();
  for (const row of punchesResult.rows) {
    if (!punchesByEmp.has(row.emp_id)) punchesByEmp.set(row.emp_id, []);
    punchesByEmp.get(row.emp_id).push(row);
  }

  const reportRows = [];
  let rowNumber = 1;

  for (const employee of employeesResult.rows) {
    const punchRows = punchesByEmp.get(employee.emp_id) || [];
    if (punchRows.length === 0) continue;

    const { rows, totalWorkedMinutes, thresholdMinutes, otMinutes } = computeEmployeeDay({
      employee, date, punchRows, settingsMap, ramzanPeriods,
    });

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

    if (otMinutes > 0) {
      await ensureOtApproval({
        empId: employee.emp_id,
        date,
        workedMinutes: totalWorkedMinutes,
        thresholdMinutes,
        otMinutes,
        reportingManagerEmpId: employee.reporting_manager_emp_id,
      });
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

      const reportRow = {
        rowNumber: rowNumber++,
        emp_id: employee.emp_id,
        cpr: employee.cpr,
        employee_name: employee.name,
        designation: employee.designation,
        cost_center: row.cost_center,
        attendance_date: date,
        start_date: date,
        start_time: row.start_time,
        end_time: row.end_time,
        end_date: date,
        working_hours: formatHours(row.working_minutes),
        job: row.project_code || '',
        project_name: row.project_name,
        remarks: row.remarks,
        ot_eligible: employee.ot_eligible,
        ot: row.is_ot_row ? formatHours(row.working_minutes) : '',
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
