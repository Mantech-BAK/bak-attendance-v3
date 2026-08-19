const pool = require('../db');

const VALID_SOURCES = ['supervisor_app', 'backoffice', 'teams'];

class TaskValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getTodaysTasks(empId) {
  const result = await pool.query(
    `SELECT id, project_code, priority, description, location_site, status
     FROM tasks
     WHERE emp_id = $1 AND task_date = CURRENT_DATE
     ORDER BY id`,
    [empId]
  );

  return result.rows.map((task) => ({
    id: task.id,
    project_code: task.project_code,
    name: task.description || task.location_site || task.project_code,
    priority: task.priority,
    status: task.status,
  }));
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

  const result = await pool.query(
    `INSERT INTO tasks (emp_id, task_date, project_code, priority, description, location_site, source, created_by)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
     RETURNING id, emp_id, task_date::text AS task_date, project_code, priority, description, location_site, status, source, created_by, created_at`,
    [emp_id, taskDate || null, project_code, priority || null, description, location_site || null, source, created_by]
  );

  return result.rows[0];
}

module.exports = { getTodaysTasks, createTask, TaskValidationError, VALID_SOURCES };
