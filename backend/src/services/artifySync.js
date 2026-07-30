const pool = require('../db');
const { fetchArtifyData } = require('../integrations/artifyClient');
const { generateUniqueLoginCode } = require('./loginCode');

const SYNC_TYPE = 'artify_pull';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000]; // delay before attempt 2 and attempt 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// default_project_code is deliberately absent from both the column list and
// the SET clause below — it's a locally-managed pointer (which project this
// department defaults to for attendance purposes), and ARTIFY has no concept
// of it. Must run before upsertEmployees/upsertProjects in the same
// transaction: employees.EmpDeptId and projects.department are FKs into
// (company_dept_id, department_name) here, so a department has to exist
// before any row referencing it is upserted.
async function upsertDepartments(client, departments) {
  for (const dept of departments) {
    await client.query(
      `INSERT INTO departments (company_dept_id, department_name, artify_last_synced)
       VALUES ($1, $2, now())
       ON CONFLICT (company_dept_id, department_name) DO UPDATE SET
         artify_last_synced = now()`,
      [dept.company, dept.department_name]
    );
  }
}

// Generates the next sequential code for a reference table (DIV003, DES009,
// ...) by taking the highest existing numeric suffix for that prefix and
// incrementing it. Needed because ARTIFY's current stub only sends plain
// text (company/designation names), never a real code — once ARTIFY starts
// supplying its own codes, this generator becomes unnecessary and callers
// should switch to using ARTIFY's code directly instead.
async function nextReferenceCode(client, table, codeColumn, prefix) {
  const { rows } = await client.query(
    `SELECT ${codeColumn} AS code FROM ${table} WHERE ${codeColumn} LIKE $1 ORDER BY ${codeColumn} DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const lastNumber = rows.length > 0 ? Number(rows[0].code.slice(prefix.length)) : 0;
  return `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
}

// divisions/designations are reference tables backing employees.EmpDivision/
// EmpDesigId (FK-constrained since the schema-rename revision), keyed by
// real generated codes (DIV001, DES001, ...) rather than text-as-code.
// ARTIFY's current stub has no concept of these as separate entities — it
// just sends a company/designation string per employee — so any name not
// already seeded gets a freshly generated sequential code here (mirroring
// upsertDepartments' auto-create-on-demand behavior), or the FK insert on
// upsertEmployees would fail. Once ARTIFY starts supplying its own codes,
// this should be replaced with using ARTIFY's code directly instead of
// generating one.
async function upsertDivisions(client, companies) {
  for (const company of new Set(companies)) {
    const existing = await client.query('SELECT division_code FROM divisions WHERE division_name = $1', [company]);
    if (existing.rows.length > 0) continue;
    const code = await nextReferenceCode(client, 'divisions', 'division_code', 'DIV');
    await client.query('INSERT INTO divisions (division_code, division_name) VALUES ($1, $2)', [code, company]);
  }
}

async function upsertDesignations(client, designations) {
  for (const designation of new Set(designations)) {
    const existing = await client.query('SELECT designation_code FROM designations WHERE designation_name = $1', [designation]);
    if (existing.rows.length > 0) continue;
    const code = await nextReferenceCode(client, 'designations', 'designation_code', 'DES');
    await client.query('INSERT INTO designations (designation_code, designation_name) VALUES ($1, $2)', [code, designation]);
  }
}

// EmpArtifyRef, EmpFaceId, EmpFingerId, EmpRegistredBy, and EmpRegisteredAt
// are deliberately absent from both the column list and the SET clause
// below. EmpArtifyRef is ARTIFY's own internal reference ID for this
// employee — a genuinely separate value from EmpId (the business key) — but
// the current ARTIFY stub doesn't supply it at all, so it's left NULL on
// insert and never touched on conflict; wire it in here once the real
// ARTIFY integration actually sends it. EmpFaceId/EmpFingerId/EmpRegistredBy/
// EmpRegisteredAt are untouched because ARTIFY owns identity/org fields
// only — it has no concept of biometric enrollment. Postgres only
// overwrites columns explicitly named in ON CONFLICT ... DO UPDATE SET, so
// omitting them here is sufficient to leave existing enrollments intact.
// Covered by test/artifySync.test.js — do not add these columns here
// without updating that test.
//
// login_code is the same story for a different reason: it's the TEMPORARY
// typed-code identification measure standing in for face capture (see
// routes/punch.js) — testers rely on an employee's code staying stable
// across re-syncs, so it must never be reassigned for an existing employee.
// A fresh code is generated for every row here, but only takes effect on a
// genuine INSERT (new employee); Postgres ignores the VALUES-supplied
// login_code entirely for a row that hits ON CONFLICT, since the DO UPDATE
// SET clause below never references it.
async function upsertEmployees(client, employees) {
  await upsertDivisions(client, employees.map((e) => e.company).filter(Boolean));
  await upsertDesignations(client, employees.map((e) => e.designation).filter(Boolean));

  for (const emp of employees) {
    const loginCode = await generateUniqueLoginCode(client);

    const [divisionRow, designationRow] = await Promise.all([
      emp.company ? client.query('SELECT division_code FROM divisions WHERE division_name = $1', [emp.company]) : { rows: [] },
      emp.designation ? client.query('SELECT designation_code FROM designations WHERE designation_name = $1', [emp.designation]) : { rows: [] },
    ]);
    const divisionCode = divisionRow.rows[0]?.division_code ?? null;
    const designationCode = designationRow.rows[0]?.designation_code ?? null;

    await client.query(
      `INSERT INTO employees
         ("EmpId", "EmpName", "EmpDivision", "EmpDeptId", "EmpDesigId", "EmpReportMgrId", "EmpStatus", "EmpOtStatus", login_code, "EmpArtifyLastSync")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT ("EmpId") DO UPDATE SET
         "EmpName" = EXCLUDED."EmpName",
         "EmpDivision" = EXCLUDED."EmpDivision",
         "EmpDeptId" = EXCLUDED."EmpDeptId",
         "EmpDesigId" = EXCLUDED."EmpDesigId",
         "EmpReportMgrId" = EXCLUDED."EmpReportMgrId",
         "EmpStatus" = EXCLUDED."EmpStatus",
         "EmpOtStatus" = EXCLUDED."EmpOtStatus",
         "EmpArtifyLastSync" = now()`,
      [
        emp.emp_id, emp.name, divisionCode, emp.department,
        designationCode, emp.reporting_manager_emp_id, emp.status, emp.ot_eligible === 'Y', loginCode,
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
    await upsertDepartments(client, data.departments);
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
    departmentCount: data.departments.length,
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
      const detail = `Synced ${result.departmentCount} departments, ${result.employeeCount} employees, ${result.projectCount} projects`;
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
