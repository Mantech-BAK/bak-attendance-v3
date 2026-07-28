const pool = require('../db');

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

module.exports = { getTodaysTasks };
