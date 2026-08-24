const pool = require('../db');
const { isWithinEmergencyWindow, getEmergencyTimeAllowance } = require('./settings');

// employee_self: an employee creating a task for themselves, mobile, no
// supervisor/backoffice involved — only allowed inside the configured
// Emergency Time Allowance window (see createTask below).
const VALID_SOURCES = ['supervisor_app', 'backoffice', 'teams', 'employee_self'];

class TaskValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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

// Deliberately NOT implemented as getTasksForDate(empId, today) — CURRENT_DATE
// is the Postgres session's own notion of today (matches how every other
// "today" query in this app resolves it), whereas computing a JS date string
// client-side can disagree with it for a few hours around local midnight,
// depending on the process's timezone. Keeping this as its own query avoids
// that mismatch entirely.
async function getTodaysTasks(empId) {
  const result = await pool.query(
    `SELECT t.id, t.project_code, t.priority, t.description, t.location_site, t.status, t.display_id,
            (SELECT count(*)::int FROM punches pu WHERE pu.task_id = t.id AND pu.approval_status <> 'rejected') AS punch_count
     FROM tasks t
     WHERE t.emp_id = $1 AND t.task_date = CURRENT_DATE
     ORDER BY t.id`,
    [empId]
  );

  if (result.rows.length > 0) {
    // Same Completed-drop as getTasksForDate above — a task at its 2-punch
    // cap disappears from the employee's own Tasks tab (and the supervisor's
    // on-behalf punch view, which reuses this same function via
    // POST /api/punch/identify) without falling through to the department
    // default, since real tasks were assigned this day regardless.
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

function deriveTaskStatus(punchCount) {
  if (punchCount === 0) return 'not_started';
  return punchCount >= 2 ? 'completed' : 'pending';
}

// Powers mobile's "My Tasks" list (item 2) — unlike getTodaysTasks above,
// this is a read-only display, not a punch-selection source, so it
// deliberately does NOT drop Completed tasks or synthesize the
// department-default fallback (there's no real task behind that one to show
// a lifecycle for). task_status is computed server-side (not_started /
// pending / completed, the same even/odd-punch-count convention as
// everywhere else) so the mobile app doesn't need to re-derive it from
// punch_count itself.
async function getTodaysTaskList(empId) {
  const result = await pool.query(
    `SELECT t.id, t.display_id, t.project_code, t.priority, t.description, t.location_site, t.task_date::text AS task_date,
            (SELECT count(*)::int FROM punches pu WHERE pu.task_id = t.id AND pu.approval_status <> 'rejected') AS punch_count
     FROM tasks t
     WHERE t.emp_id = $1 AND t.task_date = CURRENT_DATE
     ORDER BY t.id`,
    [empId]
  );

  return result.rows.map((task) => ({
    id: task.id,
    display_id: task.display_id,
    project_code: task.project_code,
    name: task.description || task.location_site || task.project_code,
    priority: task.priority,
    punch_count: task.punch_count,
    task_status: deriveTaskStatus(task.punch_count),
  }));
}

async function resolveTaskDate(taskDate) {
  if (taskDate) return taskDate;
  const { rows } = await pool.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today");
  return rows[0].today;
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
 * valid task. taskDate is optional and defaults to today (resolved via the
 * Postgres session's own CURRENT_DATE, not JS's `new Date()`, to avoid a
 * local-timezone mismatch around midnight) — only the Teams job and bulk
 * upload pass an explicit one; POST /api/tasks never accepts a
 * client-supplied date, unchanged from its existing behavior.
 */
async function createTask({ emp_id, project_code, priority, description, location_site, source, created_by, taskDate }) {
  if (!emp_id) throw new TaskValidationError(400, 'emp_id is required');
  if (!project_code) throw new TaskValidationError(400, 'project_code is required');
  if (!description) throw new TaskValidationError(400, 'description is required');
  if (!source || !VALID_SOURCES.includes(source)) {
    throw new TaskValidationError(400, `source must be one of: ${VALID_SOURCES.join(', ')}`);
  }
  if (!created_by) throw new TaskValidationError(400, 'created_by is required');

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
      const { start, end } = await getEmergencyTimeAllowance();
      throw new TaskValidationError(403, `Self-service task creation is only allowed between ${start} and ${end}`);
    }
  }

  const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
  if (employeeResult.rows.length === 0) throw new TaskValidationError(404, `employee ${emp_id} not found`);

  const creatorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [created_by]);
  if (creatorResult.rows.length === 0) throw new TaskValidationError(400, `created_by ${created_by} not found`);

  const projectResult = await pool.query('SELECT project_code FROM projects WHERE project_code = $1', [project_code]);
  if (projectResult.rows.length === 0) throw new TaskValidationError(400, `project ${project_code} not found`);

  const resolvedTaskDate = await resolveTaskDate(taskDate);

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
    `INSERT INTO tasks (emp_id, task_date, project_code, priority, description, location_site, source, created_by, display_id)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, emp_id, task_date::text AS task_date, project_code, priority, description, location_site, status, source, created_by, created_at, display_id`,
    [emp_id, resolvedTaskDate, project_code, priority || null, description, location_site || null, source, created_by, displayId]
  );

  return result.rows[0];
}

module.exports = { getTodaysTasks, getTasksForDate, getTodaysTaskList, createTask, TaskValidationError, VALID_SOURCES };
