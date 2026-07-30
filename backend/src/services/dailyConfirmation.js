const pool = require('../db');
const { getAllSettings, parseRamzanPeriods } = require('./settings');
const { getEffectiveThreshold, applyNestedSubtraction, getUtcDayBounds } = require('./attendance');

// Gaps under this many minutes between two sequential top-level projects fold
// into the preceding project's counted time; gaps at or above it become their
// own row attributed to the department's default project.
const SMALL_GAP_THRESHOLD_MINUTES = 60;
const DEFAULT_MAX_OT_MINUTES = 600; // 10 hours, used only if max_ot_minutes is somehow missing
const UNASSIGNED_LABEL = 'UNASSIGNED — no default project configured';

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

// Groups one employee's punches for one day into per-project sessions
// (First-In-Last-Out), with nested-subtraction already applied — mirrors
// calculateAttendance()'s grouping but scoped to a single employee/day.
function buildSessionsForDay(punchRows, empId, date) {
  const groups = new Map();
  for (const row of punchRows) {
    if (!groups.has(row.project_code)) {
      groups.set(row.project_code, []);
    }
    groups.get(row.project_code).push(row);
  }

  const sessions = [];
  for (const [projectCode, punches] of groups.entries()) {
    const sorted = [...punches].sort((a, b) => a.punch_time - b.punch_time);
    const punchIn = sorted[0];
    const punchOut = sorted.length > 1 ? sorted[sorted.length - 1] : null;
    const incomplete = sorted.length === 1;
    const workedMinutes = incomplete ? null : Math.round((punchOut.punch_time - punchIn.punch_time) / 60000);

    sessions.push({
      emp_id: empId,
      project_code: projectCode,
      date,
      punch_count: sorted.length,
      punch_in: { id: punchIn.id, punch_time: punchIn.punch_time },
      punch_out: punchOut ? { id: punchOut.id, punch_time: punchOut.punch_time } : null,
      incomplete,
      worked_minutes: workedMinutes,
    });
  }

  applyNestedSubtraction(sessions);
  return sessions;
}

function buildSyntheticRow({ defaultProject, workingMinutes, startTime, endTime, remarks }) {
  return {
    project_code: defaultProject ? defaultProject.project_code : null,
    project_name: defaultProject ? defaultProject.project_name : UNASSIGNED_LABEL,
    cost_center: defaultProject ? defaultProject.cost_center : null,
    start_time: startTime ?? null,
    end_time: endTime ?? null,
    working_minutes: workingMinutes,
    remarks,
    is_ot_row: false,
  };
}

/**
 * Computes one employee's one-day confirmation-sheet rows: per-project rows
 * (nested-subtraction already applied), small gaps folded into the
 * preceding project with a REMARKS note, large gaps and shortfalls
 * attributed to the department's default project (or an UNASSIGNED
 * placeholder if none is configured), and — for OT-eligible employees whose
 * true worked time exceeds the day's threshold — an OT row capped at
 * max_ot_minutes, with the true uncapped excess noted in REMARKS for
 * transparency even though only the capped amount is ever presented as
 * approvable OT.
 */
function computeEmployeeDay({ employee, date, punchRows, settingsMap, ramzanPeriods, defaultProject }) {
  const threshold = getEffectiveThreshold({
    religion: employee.religion,
    date,
    settingsMap,
    ramzanPeriods,
  });
  const maxOtMinutes = settingsMap.max_ot_minutes !== undefined
    ? Number(settingsMap.max_ot_minutes)
    : DEFAULT_MAX_OT_MINUTES;

  if (punchRows.length === 0) {
    return {
      rows: [buildSyntheticRow({
        defaultProject,
        workingMinutes: threshold.minutes,
        remarks: `Absent — no punches recorded; full-day shortfall of ${formatDurationShort(threshold.minutes)}`,
      })],
      totalWorkedMinutes: 0,
      thresholdMinutes: threshold.minutes,
      otMinutes: 0,
      trueExcessMinutes: 0,
    };
  }

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
        rows.push(buildSyntheticRow({
          defaultProject,
          workingMinutes: gapMinutes,
          startTime: session.punch_out.punch_time,
          endTime: next.punch_in.punch_time,
          remarks: `Gap of ${formatDurationShort(gapMinutes)} between projects — attributed to default project`,
        }));
        totalWorkedMinutes += gapMinutes;
      }
    }

    const rowMinutes = session.counted_minutes + extraMinutes;
    totalWorkedMinutes += rowMinutes;

    rows.push({
      project_code: session.project_code,
      project_name: null, // filled in by the caller, which has the projects lookup
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
      cost_center: null,
      start_time: session.punch_in.punch_time,
      end_time: null,
      working_minutes: 0,
      remarks: 'Incomplete session — only one punch recorded',
      is_ot_row: false,
    });
  }

  const trueExcessMinutes = Math.max(0, totalWorkedMinutes - threshold.minutes);
  const shortfallMinutes = Math.max(0, threshold.minutes - totalWorkedMinutes);
  let otMinutes = 0;

  if (shortfallMinutes > 0) {
    rows.push(buildSyntheticRow({
      defaultProject,
      workingMinutes: shortfallMinutes,
      remarks: `Shortfall — ${formatDurationShort(shortfallMinutes)} below the required ${formatDurationShort(threshold.minutes)}`,
    }));
  } else if (trueExcessMinutes > 0 && employee.ot_eligible === 'Y') {
    otMinutes = Math.min(trueExcessMinutes, maxOtMinutes);
    const cappedNote = trueExcessMinutes > maxOtMinutes
      ? ` (true excess ${formatDurationShort(trueExcessMinutes)}, capped at ${formatDurationShort(maxOtMinutes)} for approval)`
      : '';
    const lastProject = topLevel[topLevel.length - 1];

    rows.push({
      project_code: lastProject.project_code,
      project_name: null,
      cost_center: null,
      start_time: null,
      end_time: null,
      working_minutes: otMinutes,
      remarks: `Overtime${cappedNote}`,
      is_ot_row: true,
    });
  }

  return { rows, totalWorkedMinutes, thresholdMinutes: threshold.minutes, otMinutes, trueExcessMinutes };
}

/**
 * Persists one finalized confirmation-sheet row into confirmation_sheet_records
 * — the real ARTIFY-format output table, distinct from the on-demand Excel
 * export. Upserted on (EmpId, AttendanceDate, ProjectId, StartTime) so
 * re-generating the report for an already-persisted date updates existing
 * records instead of duplicating them. Postgres treats NULL as never equal
 * to NULL in a unique constraint, so untimed rows (shortfall/absentee/OT)
 * would never actually conflict on a true NULL StartTime — a fixed
 * midnight-of-the-report-date placeholder is used for those instead of NULL,
 * so idempotency holds uniformly across every row shape.
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
 * Generates every confirmation-sheet row for every active employee for one
 * date. Rows lacking a real punch time (absentee/shortfall/large-gap) sort
 * after the timed rows within each employee's block. Detecting OT here also
 * ensures a pending ot_approvals row exists for that employee/day — so
 * generating the report for a date guarantees the reporting manager sees it
 * in Review Attendance, without waiting on the nightly cron.
 */
async function generateConfirmationSheetRows(date) {
  const [settingsMap, employeesResult, projectsResult, departmentsResult, otApprovalsResult] = await Promise.all([
    getAllSettings(),
    pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
              d.division_name AS company, e."EmpDeptId" AS department, r.religion_name AS religion,
              CASE WHEN e."EmpOtStatus" THEN 'Y' ELSE 'N' END AS ot_eligible,
              e."EmpReportMgrId" AS reporting_manager_emp_id, e."EmpCpr" AS cpr
       FROM employees e
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN divisions d ON e."EmpDivision" = d.division_code
       LEFT JOIN religions r ON e."EmpReligionId" = r.religion_code
       WHERE e."EmpStatus" = 'active' ORDER BY e."EmpId"`
    ),
    pool.query('SELECT project_code, project_name, cost_center FROM projects'),
    pool.query('SELECT company_dept_id AS company, department_name, default_project_code FROM departments'),
    pool.query('SELECT emp_id, status, approved_by FROM ot_approvals WHERE work_date = $1', [date]),
  ]);

  const ramzanPeriods = parseRamzanPeriods(settingsMap);
  const projectsByCode = new Map(projectsResult.rows.map((p) => [p.project_code, p]));
  const departmentDefaults = new Map();
  for (const d of departmentsResult.rows) {
    const project = d.default_project_code ? projectsByCode.get(d.default_project_code) : null;
    departmentDefaults.set(`${d.company}|${d.department_name}`, project || null);
  }
  const otStatusByEmp = new Map(otApprovalsResult.rows.map((o) => [o.emp_id, { status: o.status, approvedBy: o.approved_by }]));

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

  const reportRows = [];
  let rowNumber = 1;

  for (const employee of employeesResult.rows) {
    const punchRows = punchesByEmp.get(employee.emp_id) || [];
    const defaultProject = departmentDefaults.get(`${employee.company}|${employee.department}`) || null;

    const { rows, totalWorkedMinutes, thresholdMinutes, otMinutes } = computeEmployeeDay({
      employee, date, punchRows, settingsMap, ramzanPeriods, defaultProject,
    });

    for (const row of rows) {
      if (row.project_code && row.project_name === null) {
        const project = projectsByCode.get(row.project_code);
        row.project_name = project ? project.project_name : row.project_code;
        row.cost_center = project ? project.cost_center : null;
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

module.exports = { generateConfirmationSheetRows, computeEmployeeDay, buildSessionsForDay, ensureOtApproval, UNASSIGNED_LABEL };
