const pool = require('../db');

const VALID_SOURCES = ['supervisor_app', 'backoffice', 'teams'];

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
    `SELECT id, project_code, priority, description, location_site, status
     FROM tasks
     WHERE emp_id = $1 AND task_date = $2::date
     ORDER BY id`,
    [empId, date]
  );

  if (result.rows.length > 0) {
    return result.rows.map((task) => ({
      id: task.id,
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
    `SELECT id, project_code, priority, description, location_site, status
     FROM tasks
     WHERE emp_id = $1 AND task_date = CURRENT_DATE
     ORDER BY id`,
    [empId]
  );

  if (result.rows.length > 0) {
    return result.rows.map((task) => ({
      id: task.id,
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
    project_code: defaultProject.project_code,
    name: defaultProject.project_name,
    priority: null,
    status: 'default',
    is_default: true,
  }];
}

/**
 * Shared validation + insert used by both POST /api/tasks and the Teams
 * intake job, so the two entry points can never drift on what counts as a
 * valid task. taskDate is optional and defaults to CURRENT_DATE (today) —
 * only the Teams job passes an explicit one, parsed from its "Task Date"
 * column; POST /api/tasks never accepts a client-supplied date, unchanged
 * from its existing behavior.
 */
async function createTask({ emp_id, project_code, priority, description, location_site, source, created_by, taskDate }) {
  if (!emp_id) throw new TaskValidationError(400, 'emp_id is required');
  if (!project_code) throw new TaskValidationError(400, 'project_code is required');
  if (!description) throw new TaskValidationError(400, 'description is required');
  if (!source || !VALID_SOURCES.includes(source)) {
    throw new TaskValidationError(400, `source must be one of: ${VALID_SOURCES.join(', ')}`);
  }
  if (!created_by) throw new TaskValidationError(400, 'created_by is required');

  const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
  if (employeeResult.rows.length === 0) throw new TaskValidationError(404, `employee ${emp_id} not found`);

  const creatorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [created_by]);
  if (creatorResult.rows.length === 0) throw new TaskValidationError(400, `created_by ${created_by} not found`);

  const projectResult = await pool.query('SELECT project_code FROM projects WHERE project_code = $1', [project_code]);
  if (projectResult.rows.length === 0) throw new TaskValidationError(400, `project ${project_code} not found`);

  // Same employee + same day + same project is a duplicate — a different
  // project for that employee that day is still a distinct, legitimate task
  // and stays allowed. Status is never checked: tasks never transition off
  // 'pending' anywhere in this system, so an existing row always counts.
  const duplicateResult = await pool.query(
    `SELECT id FROM tasks WHERE emp_id = $1 AND project_code = $2 AND task_date = COALESCE($3::date, CURRENT_DATE)`,
    [emp_id, project_code, taskDate || null]
  );
  if (duplicateResult.rows.length > 0) {
    throw new TaskValidationError(409, 'This task already exists.');
  }

  const result = await pool.query(
    `INSERT INTO tasks (emp_id, task_date, project_code, priority, description, location_site, source, created_by)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
     RETURNING id, emp_id, task_date::text AS task_date, project_code, priority, description, location_site, status, source, created_by, created_at`,
    [emp_id, taskDate || null, project_code, priority || null, description, location_site || null, source, created_by]
  );

  return result.rows[0];
}

module.exports = { getTodaysTasks, getTasksForDate, createTask, TaskValidationError, VALID_SOURCES };
