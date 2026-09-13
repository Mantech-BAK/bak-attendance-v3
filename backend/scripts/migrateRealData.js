// One-time real-data migration: replaces all test employees/projects/
// divisions/departments/designations with real MANTECH company data read
// from the "List of Employees" and "List of Projects" sheets of the source
// workbook. Every other sheet in the workbook (daily timesheet exports) is
// ignored. Run against local and production by pointing DATABASE_URL at
// each in turn (see backend/.env).
//
// Usage: node scripts/migrateRealData.js "<path to xlsx>" --confirm=MIGRATE
require('dotenv').config();
const ExcelJS = require('exceljs');
const pool = require('../src/db');

const XLSX_PATH = process.argv[2];
const CONFIRM = process.argv.includes('--confirm=MIGRATE');

if (!XLSX_PATH) {
  console.error('Usage: node scripts/migrateRealData.js "<path to xlsx>" --confirm=MIGRATE');
  process.exit(1);
}
if (!CONFIRM) {
  console.error('Refusing to run without --confirm=MIGRATE (this destroys all current employees/projects/departments/divisions/designations).');
  process.exit(1);
}

const RESIGNED_REMARKS = new Set(['EMPLOYEE RESIGNED', 'NOT IN MANTECH']);
const RELIGION_CODE_BY_NAME = { Muslim: 'REL001', Christian: 'REL002', Hindu: 'REL003', Other: 'REL004' };
const RELIGION_ALIAS = { Buddhism: 'Other', Sikh: 'Other' };

function normStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function padCpr(rawCpr) {
  if (rawCpr === null || rawCpr === undefined) return null;
  const s = String(rawCpr).trim();
  if (s === '' || s === '--') return null;
  return s.padStart(9, '0');
}

function normOtEligible(raw) {
  const s = normStr(raw);
  if (!s) return false;
  const u = s.toUpperCase();
  return u === 'YES' || u === 'HOLIDAYS & FRIDAY ONLY';
}

function normReligionCode(raw) {
  let s = normStr(raw);
  if (!s || s === '--') return null;
  s = RELIGION_ALIAS[s] || s;
  return RELIGION_CODE_BY_NAME[s] || RELIGION_CODE_BY_NAME.Other;
}

function normDesignation(raw) {
  const s = normStr(raw);
  if (!s || s === '--') return null;
  return s;
}

function normProjectStatus(raw) {
  const s = (normStr(raw) || '').toUpperCase();
  return s === 'CLOSE' || s === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function randomLoginCode() {
  let out = '';
  for (let i = 0; i < 5; i++) out += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return out;
}
function generateUniqueLoginCodes(n) {
  const codes = new Set();
  while (codes.size < n) codes.add(randomLoginCode());
  return [...codes];
}

async function extractSheets(xlsxPath) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
  });
  const WANTED = new Set(['List of Employees', 'List of Projects']);
  const EMP_COLS = [null, 'id', 'name', 'nationality', 'joiningDate', 'company', 'department', 'designation', 'religion', 'gender', 'officeShift', 'otEligible', 'cpr', 'crName', 'crNumber', 'reportingManager', 'sapDatabase', 'costCenter', 'remarks'];
  const PROJ_COLS = [null, 'projectCode', 'projectName', 'projectCompanyName', 'soNo', 'projectValue', 'status'];

  function rowToObj(values, cols) {
    const obj = {};
    for (let i = 1; i < cols.length; i++) {
      let v = values[i];
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      obj[cols[i]] = v === undefined ? null : v;
    }
    return obj;
  }

  const employees = [];
  const projects = [];
  for await (const worksheetReader of reader) {
    if (!WANTED.has(worksheetReader.name)) {
      for await (const _row of worksheetReader) { /* skip unrelated sheets */ }
      continue;
    }
    let rowNum = 0;
    for await (const row of worksheetReader) {
      rowNum++;
      if (rowNum === 1) continue; // header
      if (worksheetReader.name === 'List of Employees') employees.push(rowToObj(row.values, EMP_COLS));
      else projects.push(rowToObj(row.values, PROJ_COLS));
    }
  }
  return { employees, projects };
}

async function main() {
  const { employees: rawEmployees, projects: rawProjects } = await extractSheets(XLSX_PATH);
  console.log(`Read ${rawEmployees.length} employee rows, ${rawProjects.length} project rows from source.`);

  // ---- Transform projects ----
  const projects = rawProjects.map((p) => ({
    projectCode: String(p.projectCode),
    projectName: normStr(p.projectName),
    company: normStr(p.projectCompanyName),
    status: normProjectStatus(p.status),
  }));

  // ---- Transform employees ----
  const loginCodes = generateUniqueLoginCodes(rawEmployees.length);
  const employees = rawEmployees.map((e, idx) => {
    const cpr = padCpr(e.cpr);
    const empId = cpr || String(e.id); // Hasan Qroof (no CPR) falls back to the old internal ID
    const remarks = normStr(e.remarks);
    return {
      empId,
      empArtifyRef: String(e.id),
      empCpr: cpr, // null when genuinely unknown (Hasan Qroof) — not backfilled with empId
      name: normStr(e.name),
      company: normStr(e.company),
      department: normStr(e.department),
      designation: normDesignation(e.designation),
      religionCode: normReligionCode(e.religion),
      otEligible: normOtEligible(e.otEligible),
      status: remarks && RESIGNED_REMARKS.has(remarks) ? 'inactive' : 'active',
      loginCode: loginCodes[idx],
    };
  });

  // ---- Build reference master data ----
  const divisionCodeByName = new Map(); // company name -> division_code
  const designationCodeByName = new Map(); // designation name -> designation_code
  const departmentPairs = new Map(); // "company||department" -> {company, department}

  for (const e of employees) {
    if (e.company && !divisionCodeByName.has(e.company)) {
      divisionCodeByName.set(e.company, `DIV${String(divisionCodeByName.size + 1).padStart(3, '0')}`);
    }
    if (e.designation && !designationCodeByName.has(e.designation)) {
      designationCodeByName.set(e.designation, `DES${String(designationCodeByName.size + 1).padStart(3, '0')}`);
    }
    if (e.company && e.department) {
      departmentPairs.set(`${e.company}||${e.department}`, { company: e.company, department: e.department });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe generated activity (standing reset behavior) then master data.
    await client.query('TRUNCATE TABLE confirmation_sheet_records, ot_approvals, exceptions, tasks, punches, task_id_counters RESTART IDENTITY');
    await client.query('DELETE FROM employees');
    await client.query('DELETE FROM departments');
    await client.query('DELETE FROM projects');
    await client.query('DELETE FROM divisions');
    await client.query('DELETE FROM designations');

    for (const [name, code] of divisionCodeByName) {
      await client.query('INSERT INTO divisions (division_code, division_name) VALUES ($1, $2)', [code, name]);
    }
    for (const { company, department } of departmentPairs.values()) {
      await client.query(
        'INSERT INTO departments (company_dept_id, department_name) VALUES ($1, $2)',
        [company, department]
      );
    }
    for (const [name, code] of designationCodeByName) {
      await client.query('INSERT INTO designations (designation_code, designation_name) VALUES ($1, $2)', [code, name]);
    }

    for (const p of projects) {
      await client.query(
        'INSERT INTO projects (project_code, project_name, company, status) VALUES ($1, $2, $3, $4)',
        [p.projectCode, p.projectName, p.company, p.status]
      );
    }

    for (const e of employees) {
      await client.query(
        `INSERT INTO employees
           ("EmpId", "EmpArtifyRef", "EmpCpr", "EmpName", "EmpDivision", "EmpDeptId", "EmpDesigId",
            "EmpReligionId", "EmpOtStatus", "EmpStatus", "EmpReportMgrId", is_supervisor, login_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, false, $11)`,
        [
          e.empId,
          e.empArtifyRef,
          e.empCpr,
          e.name,
          e.company ? divisionCodeByName.get(e.company) : null,
          e.department,
          e.designation ? designationCodeByName.get(e.designation) : null,
          e.religionCode,
          e.otEligible,
          e.status,
          e.loginCode,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('Migration committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`Inserted ${employees.length} employees, ${projects.length} projects, ${divisionCodeByName.size} divisions, ${departmentPairs.size} departments, ${designationCodeByName.size} designations.`);
  await pool.end();
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
