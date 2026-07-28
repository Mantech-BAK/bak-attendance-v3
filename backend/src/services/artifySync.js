const pool = require('../db');
const { fetchArtifyData } = require('../integrations/artifyClient');

const SYNC_TYPE = 'artify_pull';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000]; // delay before attempt 2 and attempt 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertEmployees(client, employees) {
  for (const emp of employees) {
    await client.query(
      `INSERT INTO employees
         (emp_id, name, company, department, designation, reporting_manager_emp_id, status, ot_eligible, artify_last_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (emp_id) DO UPDATE SET
         name = EXCLUDED.name,
         company = EXCLUDED.company,
         department = EXCLUDED.department,
         designation = EXCLUDED.designation,
         reporting_manager_emp_id = EXCLUDED.reporting_manager_emp_id,
         status = EXCLUDED.status,
         ot_eligible = EXCLUDED.ot_eligible,
         artify_last_synced = now()`,
      [
        emp.emp_id, emp.name, emp.company, emp.department,
        emp.designation, emp.reporting_manager_emp_id, emp.status, emp.ot_eligible,
      ]
    );
  }
}

async function upsertProjects(client, projects) {
  for (const proj of projects) {
    await client.query(
      `INSERT INTO projects (project_code, project_name, company, status, artify_last_synced)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (project_code) DO UPDATE SET
         project_name = EXCLUDED.project_name,
         company = EXCLUDED.company,
         status = EXCLUDED.status,
         artify_last_synced = now()`,
      [proj.project_code, proj.project_name, proj.company, proj.status]
    );
  }
}

async function logSyncRun({ status, detail, attemptCount }) {
  await pool.query(
    `INSERT INTO artify_sync_log (sync_type, status, detail, attempt_count)
     VALUES ($1, $2, $3, $4)`,
    [SYNC_TYPE, status, detail, attemptCount]
  );
}

async function logException({ details }) {
  await pool.query(
    `INSERT INTO exceptions (type, ref_table, details)
     VALUES ($1, $2, $3)`,
    ['artify_sync_failure', 'artify_sync_log', details]
  );
}

async function runSyncAttempt() {
  const data = await fetchArtifyData();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertEmployees(client, data.employees);
    await upsertProjects(client, data.projects);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    employeeCount: data.employees.length,
    projectCount: data.projects.length,
  };
}

/**
 * Runs the ARTIFY pull-and-upsert sync with retry (3 attempts, increasing
 * delay). Every attempt is logged to artify_sync_log. If all attempts fail,
 * a row is written to exceptions.
 */
async function runArtifySync() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runSyncAttempt();
      const detail = `Synced ${result.employeeCount} employees, ${result.projectCount} projects`;
      await logSyncRun({ status: 'success', detail, attemptCount: attempt });
      return { success: true, attempt, ...result };
    } catch (err) {
      lastError = err;
      await logSyncRun({ status: 'failed', detail: err.message, attemptCount: attempt });

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }

  await logException({
    details: `ARTIFY sync failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`,
  });

  return { success: false, attempts: MAX_ATTEMPTS, error: lastError.message };
}

module.exports = { runArtifySync };
