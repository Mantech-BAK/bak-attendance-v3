const pool = require('../db');
const {
  isWithinEmergencyWindow, getEmergencyTimeAllowance, utcHHMMToLocalHHMM,
  getAllSettings, parseSummerBanPeriods, isWithinSummerBan, getBahrainDateKey,
} = require('./settings');

// employee_self: an employee creating a task for themselves, mobile, no
// supervisor/backoffice involved — only allowed inside the configured
// Emergency Time Allowance window (see createTask below).
const VALID_SOURCES = ['supervisor_app', 'backoffice', 'teams', 'employee_self'];

// Regular/Night (2026-09-14) — unlike is_outdoor, this is never gated behind
// any active-period concept: it's always a real, meaningful property of a
// task, shown on every creation surface. Defaults to 'regular' whenever a
// caller doesn't send one at all (silently, not an error) so the automated
// Teams intake path and any other non-interactive caller keep working
// unchanged — only a value that's actually PRESENT but not one of these two
// is rejected as a real input mistake.
const VALID_SHIFT_TYPES = ['regular', 'night'];

class TaskValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A reported leave of ANY type (Sick, Annual, Emergency, Unpaid,
// Compassionate) on a date suppresses the department-default fallback task
// for that employee/date (2026-09-24) — someone on leave shouldn't be offered
// a default project to punch against. Only the fallback is affected: a real
// assigned task still shows up as normal.
async function hasReportedLeave(empId, date) {
  const result = await pool.query(
    'SELECT 1 FROM leave_reports WHERE emp_id = $1 AND leave_date = $2::date LIMIT 1',
    [empId, date]
  );
  return result.rows.length > 0;
}

/**
 * Same department-default-project lookup used by the Confirmation Sheet's
 * gap-filling (dailyConfirmation.js) — company via EmpDivision→divisions,
 * department via EmpDeptId matched against departments.department_name.
 * Returns null if the department has no default_project_code configured,
 * mirroring that report's UNASSIGNED case.
 */
async function getDepartmentDefaultProject(empId) {
  const result = await pool.query(
    `SELECT p.project_code, p.project_name
     FROM employees e
     LEFT JOIN divisions dv ON e."EmpDivision" = dv.division_code
     LEFT JOIN departments d ON d.company_dept_id = dv.division_name AND d.department_name = e."EmpDeptId"
     LEFT JOIN projects p ON p.project_code = d.default_project_code
     WHERE e."EmpId" = $1`,
    [empId]
  );

  const row = result.rows[0];
  return row && row.project_code ? row : null;
}

/**
 * Batch form of getDepartmentDefaultProject above, one query for every
 * employee instead of one query per employee — used by the Confirmation
 * Sheet's gap-handling (dailyConfirmation.js, restored 2026-09-15) when a
 * gap sits next to an emergency-created task: that gap reverts to being
 * attributed to the department's default project, the original pre-2026-08-30
 * gap-handling behavior, rather than becoming a "Travelling Time" row.
 * A department with no default project configured maps to null, same
 * UNASSIGNED meaning as the single-employee version above.
 */
async function getDefaultProjectByEmpIdMap() {
  const result = await pool.query(
    `SELECT e."EmpId" AS emp_id, p.project_code, p.project_name
     FROM employees e
     LEFT JOIN divisions dv ON e."EmpDivision" = dv.division_code
     LEFT JOIN departments d ON d.company_dept_id = dv.division_name AND d.department_name = e."EmpDeptId"
     LEFT JOIN projects p ON p.project_code = d.default_project_code`
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.emp_id, row.project_code ? { project_code: row.project_code, project_name: row.project_name } : null);
  }
  return map;
}

/**
 * An employee with zero real tasks assigned on this date still needs
 * something punchable, so this falls back to their department's default
 * project (the same one the Confirmation Sheet attributes gaps/shortfalls
 * to) as a single synthetic task. Employees with any real task never see
 * this — it's a fallback, not an addition. A department with no default
 * project configured yields no tasks at all: there's no real project_code to
 * punch against (punches.project_code is a hard FK into projects), so this
 * is the same "can't punch" outcome the report already represents as
 * UNASSIGNED.
 *
 * date is a required 'YYYY-MM-DD' string bound as a real SQL date parameter
 * (never string-concatenated), so callers can ask about any day, not just
 * today — used by both mobile's Punch tab (today) and the backoffice's Add
 * Punch project restriction (whatever date the admin is correcting).
 */
async function getTasksForDate(empId, date) {
  const result = await pool.query(
    `SELECT t.id, t.project_code, t.priority, t.description, t.location_site, t.status, t.display_id,
            (SELECT count(*)::int FROM punches pu WHERE pu.task_id = t.id AND pu.approval_status <> 'rejected') AS punch_count
     FROM tasks t
     WHERE t.emp_id = $1 AND t.task_date = $2::date
     ORDER BY t.id`,
    [empId, date]
  );

  if (result.rows.length > 0) {
    // A task at its 2-punch cap is Completed and no longer punchable — drop
    // it from the list rather than the fallback below, which only ever
    // applies when NO real task was assigned that day at all (see the
    // comment above getDepartmentDefaultProject's usage below).
    return result.rows
      .filter((task) => task.punch_count < 2)
      .map((task) => ({
        id: task.id,
        display_id: task.display_id,
        project_code: task.project_code,
        name: task.description || task.location_site || task.project_code,
        priority: task.priority,
        status: task.status,
        is_default: false,
      }));
  }

  if (await hasReportedLeave(empId, date)) return [];

  const defaultProject = await getDepartmentDefaultProject(empId);
  if (!defaultProject) return [];

  return [{
    id: null,
    display_id: null,
    project_code: defaultProject.project_code,
    name: defaultProject.project_name,
    priority: null,
    status: 'default',
    is_default: true,
  }];
}

// Deliberately NOT implemented as getTasksForDate(empId, today) with a
// caller-supplied date — "today" is always resolved fresh, right here,
// via getBahrainDateKey(new Date()) (2026-09-16 timezone audit). This
// used to rely on Postgres's own CURRENT_DATE, on the theory that a
// JS-computed date string could disagree with it around local midnight
// depending on the Node process's own timezone — but CURRENT_DATE instead
// depends on the DB session's configured timezone, which is just as
// environment-fragile (confirmed: UTC in production, a different default
// in local dev, silently disagreeing with each other and with the real
// Bahrain business day). getBahrainDateKey uses Intl with an explicit
// timeZone, so it's correct regardless of either the Node process's or the
// DB session's own timezone — nothing here depends on ambient config.
//
// A task at its 2-punch cap stays in this list (unlike the old behavior,
// which dropped it entirely) — it's unpunchable but must remain visible with
// its Closed status, for both the employee's own Punch tab and the
// supervisor's on-behalf punch view, which both reuse this same function via
// POST /api/punch/identify. punch_count/task_status let the client render
// that without re-deriving it.
async function getTodaysTasks(empId) {
  const today = getBahrainDateKey(new Date());
  const result = await pool.query(
    `SELECT t.id, t.project_code, t.priority, t.description, t.location_site, t.status, t.display_id,
            (SELECT count(*)::int FROM punches pu WHERE pu.task_id = t.id AND pu.approval_status <> 'rejected') AS punch_count,
            in_p.id AS in_punch_id, in_p.photo_path AS in_photo_path,
            out_p.id AS out_punch_id, out_p.photo_path AS out_photo_path
     FROM tasks t
     LEFT JOIN LATERAL (
       SELECT id, photo_path FROM punches
       WHERE task_id = t.id AND approval_status <> 'rejected'
       ORDER BY punch_time ASC LIMIT 1
     ) in_p ON true
     LEFT JOIN LATERAL (
       SELECT id, photo_path FROM punches
       WHERE task_id = t.id AND approval_status <> 'rejected'
       ORDER BY punch_time ASC LIMIT 1 OFFSET 1
     ) out_p ON true
     WHERE t.emp_id = $1 AND t.task_date = $2::date
     ORDER BY t.id`,
    [empId, today]
  );

  if (result.rows.length > 0) {
    // in_punch_id/out_punch_id are null until that punch actually exists —
    // the mobile client uses them to know which punch to upload a photo
    // against (POST /api/punches/:id/photo). Never populated for the
    // department-default fallback below — photos are scoped to real tasks
    // only (2026-09-14).
    return result.rows.map((task) => ({
      id: task.id,
      display_id: task.display_id,
      project_code: task.project_code,
      name: task.description || task.location_site || task.project_code,
      priority: task.priority,
      status: task.status,
      punch_count: task.punch_count,
      task_status: deriveTaskStatus(task.punch_count),
      is_default: false,
      in_punch_id: task.in_punch_id,
      in_photo_uploaded: task.in_punch_id ? !!task.in_photo_path : null,
      out_punch_id: task.out_punch_id,
      out_photo_uploaded: task.out_punch_id ? !!task.out_photo_path : null,
    }));
  }

  if (await hasReportedLeave(empId, today)) return [];

  const defaultProject = await getDepartmentDefaultProject(empId);
  if (!defaultProject) return [];

  return [{
    id: null,
    display_id: null,
    project_code: defaultProject.project_code,
    name: defaultProject.project_name,
    priority: null,
    status: 'default',
    punch_count: 0,
    task_status: null,
    is_default: true,
  }];
}

function deriveTaskStatus(punchCount) {
  if (punchCount === 0) return 'not_started';
  return punchCount >= 2 ? 'completed' : 'pending';
}

// The interactive Create Task forms (mobile Punch, Create Team Task, Scan
// Team Member) never pass an explicit taskDate, so this default IS "today"
// for them — resolved via getBahrainDateKey(new Date()) (2026-09-16
// timezone audit), not Postgres's CURRENT_DATE: CURRENT_DATE depends on
// the DB session's own timezone, which was UTC in production and a
// different, unpinned default in local dev — the two disagreeing is
// exactly the kind of drift this audit closed. Bulk upload and the Teams
// intake job are the only callers that pass a real, possibly-future
// taskDate explicitly.
async function resolveTaskDate(taskDate) {
  return taskDate || getBahrainDateKey(new Date());
}

function formatDisplayId(taskDate, counter) {
  const [y, m, d] = taskDate.split('-');
  return `TASK-${d}${m}${y}-${String(counter).padStart(3, '0')}`;
}

/**
 * Assigns the next TASK-DDMMYYYY-XXX reference id for a given task_date —
 * XXX is a per-day sequential counter (resets to 001 for a date never seen
 * before), keyed by the task's own scheduled date, not the moment of
 * creation, so a batch of tasks bulk-uploaded for a future date get
 * consecutive numbers under THAT date. The counter lives in its own table
 * (task_id_counters) and is bumped via a single atomic UPSERT, so two tasks
 * created concurrently for the same date (e.g. two rows in one bulk upload)
 * can never collide — Postgres serializes concurrent UPDATEs to the same
 * row. Purely a display/reference id — never used for lookups internally,
 * that's still tasks.id.
 */
async function getNextTaskDisplayId(taskDate) {
  const { rows } = await pool.query(
    `INSERT INTO task_id_counters (task_date, counter) VALUES ($1::date, 1)
     ON CONFLICT (task_date) DO UPDATE SET counter = task_id_counters.counter + 1
     RETURNING counter`,
    [taskDate]
  );
  return formatDisplayId(taskDate, rows[0].counter);
}

/**
 * Shared validation + insert used by both POST /api/tasks and the Teams
 * intake job, so the two entry points can never drift on what counts as a
 * valid task. taskDate is optional and defaults to today (resolved via
 * resolveTaskDate() above, i.e. getBahrainDateKey — see its own comment)
 * — only the Teams job and bulk upload pass an explicit one; POST
 * /api/tasks never accepts a client-supplied date, unchanged from its
 * existing behavior.
 */
async function createTask({ emp_id, project_code, priority, description, location_site, source, created_by, taskDate, is_outdoor, shift_type }) {
  if (!emp_id) throw new TaskValidationError(400, 'emp_id is required');
  if (!project_code) throw new TaskValidationError(400, 'project_code is required');
  if (!description) throw new TaskValidationError(400, 'description is required');
  if (!source || !VALID_SOURCES.includes(source)) {
    throw new TaskValidationError(400, `source must be one of: ${VALID_SOURCES.join(', ')}`);
  }
  if (!created_by) throw new TaskValidationError(400, 'created_by is required');
  if (shift_type !== undefined && shift_type !== null && !VALID_SHIFT_TYPES.includes(shift_type)) {
    throw new TaskValidationError(400, `shift_type must be one of: ${VALID_SHIFT_TYPES.join(', ')}`);
  }
  const resolvedShiftType = VALID_SHIFT_TYPES.includes(shift_type) ? shift_type : 'regular';

  // Resolved up front (moved ahead of the is_outdoor gate below, 2026-09-15)
  // — the interactive Create Task forms never pass an explicit taskDate, so
  // this is always "today" for them, unchanged; only bulk upload (and the
  // Teams intake job) pass a real, possibly-future one.
  const resolvedTaskDate = await resolveTaskDate(taskDate);

  // Indoor/Outdoor (2026-09-14, date-scoping corrected 2026-09-15) — only
  // ever asked, and only ever stored, when the TASK'S OWN scheduled date
  // (resolvedTaskDate) falls within a declared Summer Ban period — not
  // whether one happens to be active at the moment of creation. This
  // matters for bulk upload especially: a whole batch of future-dated tasks
  // uploaded today, some inside a not-yet-started (or already-ended) period
  // and some outside it, must each be gated on their OWN date, not today's.
  // Outside a period for that date, whatever the client sent is silently
  // ignored — the feature is meant to be entirely dormant then, not
  // something that errors on stale UI state. Inside one, an explicit answer
  // is mandatory — silently defaulting to "indoor" would quietly exempt a
  // real outdoor task from the ban rules.
  const summerBanSettingsMap = await getAllSettings();
  const summerBanActiveForTaskDate = isWithinSummerBan(resolvedTaskDate, parseSummerBanPeriods(summerBanSettingsMap));
  let resolvedIsOutdoor = null;
  if (summerBanActiveForTaskDate) {
    if (typeof is_outdoor !== 'boolean') {
      throw new TaskValidationError(400, 'is_outdoor (true/false) is required because this task\'s date falls within a declared Summer Ban period');
    }
    resolvedIsOutdoor = is_outdoor;
  }

  // employee_self is the one source where the creator and the assignee must
  // be the same person — an employee can only self-create a task for
  // themselves, never attribute one to someone else this way (that's what
  // supervisor_app/backoffice are for) — and only inside the configured
  // night-time window; outside it, only a supervisor or backoffice can
  // assign them work, same as always.
  if (source === 'employee_self') {
    if (emp_id !== created_by) {
      throw new TaskValidationError(403, 'employee_self tasks can only be self-created — emp_id must match created_by');
    }
    if (!(await isWithinEmergencyWindow())) {
      // Stored/compared in UTC, converted to Asia/Riyadh only for this
      // message — an employee reading the rejection reason needs their own
      // real local hours, not the raw UTC storage value.
      const { start, end } = await getEmergencyTimeAllowance();
      throw new TaskValidationError(403, `Self-service task creation is only allowed between ${utcHHMMToLocalHHMM(start)} and ${utcHHMMToLocalHHMM(end)}`);
    }
  }

  const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
  if (employeeResult.rows.length === 0) throw new TaskValidationError(404, `employee ${emp_id} not found`);

  const creatorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [created_by]);
  if (creatorResult.rows.length === 0) throw new TaskValidationError(400, `created_by ${created_by} not found`);

  const projectResult = await pool.query('SELECT project_code, status FROM projects WHERE project_code = $1', [project_code]);
  if (projectResult.rows.length === 0) throw new TaskValidationError(400, `project ${project_code} not found`);
  // Applies regardless of source (backoffice, supervisor_app, employee_self,
  // teams) — createTask is the single shared entry point every task-creation
  // path funnels through, so this can't be bypassed by any client.
  if (projectResult.rows[0].status !== 'OPEN') {
    throw new TaskValidationError(400, `project ${project_code} is closed and cannot accept new tasks`);
  }

  // Same employee + same day + same project + same description (exact
  // match) is a duplicate — a different description on that same
  // project/day is a distinct, legitimate second task (e.g. two separate
  // things to do on the same project that day), and stays allowed. A
  // different project for that employee that day is likewise always
  // allowed. Status is never checked: tasks never transition off 'pending'
  // anywhere in this system, so an existing row always counts.
  const duplicateResult = await pool.query(
    `SELECT id FROM tasks WHERE emp_id = $1 AND project_code = $2 AND task_date = $3::date AND description = $4`,
    [emp_id, project_code, resolvedTaskDate, description]
  );
  if (duplicateResult.rows.length > 0) {
    throw new TaskValidationError(409, 'This task already exists.');
  }

  const displayId = await getNextTaskDisplayId(resolvedTaskDate);

  const result = await pool.query(
    `INSERT INTO tasks (emp_id, task_date, project_code, priority, description, location_site, source, created_by, display_id, is_outdoor, shift_type)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, emp_id, task_date::text AS task_date, project_code, priority, description, location_site, status, source, created_by, created_at, display_id, is_outdoor, shift_type`,
    [emp_id, resolvedTaskDate, project_code, priority || null, description, location_site || null, source, created_by, displayId, resolvedIsOutdoor, resolvedShiftType]
  );

  return result.rows[0];
}

/**
 * Assigns the same task (project/priority/description/location) to multiple
 * employees at once, creating one row per emp_id — mirrors
 * taskBulkUpload.processBulkUpload's partial-success loop, reusing the same
 * createTask validation/duplicate-check for each employee independently, so
 * a duplicate or validation failure for one employee never blocks the
 * others in the same batch.
 */
async function createTasksBulk({ emp_ids, project_code, priority, description, location_site, source, created_by, taskDate, is_outdoor, shift_type }) {
  if (!Array.isArray(emp_ids) || emp_ids.length === 0) {
    throw new TaskValidationError(400, 'emp_ids must be a non-empty array');
  }

  const created = [];
  const errors = [];

  for (const emp_id of emp_ids) {
    try {
      const task = await createTask({ emp_id, project_code, priority, description, location_site, source, created_by, taskDate, is_outdoor, shift_type });
      created.push(task);
    } catch (err) {
      const reason = err instanceof TaskValidationError ? err.message : 'unexpected error creating the task';
      errors.push({ emp_id, reason });
    }
  }

  return { created, errors, totalRequested: emp_ids.length };
}

module.exports = {
  getTodaysTasks, getTasksForDate, createTask, createTasksBulk, TaskValidationError, VALID_SOURCES,
  getDefaultProjectByEmpIdMap,
};
