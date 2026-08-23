const ExcelJS = require('exceljs');
const pool = require('../db');
const { createTask, TaskValidationError } = require('./tasks');

// Same column order as teamsParser.js's pasted-row intake — Employee ID,
// Task Date, Project Code, Priority, Description, Location — so an admin
// moving between the Teams flow and this one sees a consistent layout.
// Location is the only optional one: the manual Create Task form never
// requires it either.
const TEMPLATE_COLUMNS = [
  { header: 'Employee ID *', key: 'emp_id', width: 16, note: 'Must match an existing, active employee ID (e.g. E1005).' },
  { header: 'Task Date *', key: 'task_date', width: 16, note: 'Format: YYYY-MM-DD. Can be any date, not just today — this is what schedules the task.' },
  { header: 'Project Code *', key: 'project_code', width: 16, note: 'Must match an existing project code (e.g. PRJ-001).' },
  { header: 'Priority *', key: 'priority', width: 14, note: 'One of: low, medium, high.' },
  { header: 'Description *', key: 'description', width: 40, note: 'Required — describe the task.' },
  { header: 'Location', key: 'location_site', width: 24, note: 'Optional.' },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_VALUES = ['low', 'medium', 'high'];

async function buildTaskTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tasks');

  sheet.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, i) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.note = TEMPLATE_COLUMNS[i - 1].note;
  });

  return workbook;
}

// Excel date cells come back from ExcelJS as JS Date objects already
// normalized to UTC midnight for the calendar day shown — using UTC
// getters (not toISOString, which is fine here too since there's no
// time-of-day component, but explicit UTC getters make the intent clear
// and avoid ever drifting through a local-timezone reading) keeps the
// stored task_date matching exactly what the cell displays.
function cellToDateString(value) {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').trim();
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text).trim();
  if (typeof value === 'object' && 'result' in value) return String(value.result).trim();
  return String(value).trim();
}

/**
 * Reads every non-header, non-blank row of the first worksheet into the
 * six template columns, in order. Row numbers are 1-indexed and match what
 * the admin actually sees in Excel (row 1 is the header), so an error
 * report can point them straight at the offending row.
 */
function parseUploadedWorkbook(workbook) {
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const cells = [
      cellToString(row.getCell(1).value),
      cellToDateString(row.getCell(2).value),
      cellToString(row.getCell(3).value),
      cellToString(row.getCell(4).value),
      cellToString(row.getCell(5).value),
      cellToString(row.getCell(6).value),
    ];
    if (cells.every((c) => c === '')) return; // trailing blank row

    rows.push({ rowNumber, cells });
  });

  return rows;
}

/**
 * Row-level checks ahead of createTask() — required-field presence, date
 * format, and priority enum, none of which createTask() itself enforces
 * (manual creation gets away with it because the UI form's dropdown always
 * sends a valid value and never lets Description/etc. through blank; the
 * Teams intake path deliberately leaves priority optional). Employee
 * existence there only requires the row exists; whether that employee is
 * *active* is also checked here, since neither manual nor Teams creation
 * currently do — this is deliberately stricter than either, kept local to
 * bulk upload rather than changed globally in createTask().
 */
function validateBulkRow(cells, { employeeStatusByEmpId, projectCodes }) {
  const [empId, taskDate, projectCode, priorityRaw, description, locationSite] = cells;

  if (!empId) return { valid: false, empId: 'UNKNOWN', reason: 'Employee ID is required' };
  if (!employeeStatusByEmpId.has(empId)) {
    return { valid: false, empId, reason: `employee ${empId} not found` };
  }
  if (employeeStatusByEmpId.get(empId) !== 'active') {
    return { valid: false, empId, reason: `employee ${empId} is not active` };
  }

  if (!taskDate || !DATE_PATTERN.test(taskDate)) {
    return { valid: false, empId, reason: 'Task Date is required and must be in YYYY-MM-DD format' };
  }

  if (!projectCode) return { valid: false, empId, reason: 'Project Code is required' };
  if (!projectCodes.has(projectCode)) {
    return { valid: false, empId, reason: `project ${projectCode} not found` };
  }

  const priority = priorityRaw.toLowerCase();
  if (!priority || !PRIORITY_VALUES.includes(priority)) {
    return { valid: false, empId, reason: `Priority is required and must be one of: ${PRIORITY_VALUES.join(', ')}` };
  }

  if (!description) return { valid: false, empId, reason: 'Description is required' };

  return {
    valid: true,
    task: {
      emp_id: empId,
      taskDate,
      project_code: projectCode,
      priority,
      description,
      location_site: locationSite || null,
    },
  };
}

/**
 * Partial-success processing, mirroring teamsSync.processMessage(): every
 * row is validated and attempted independently, so one bad row (bad
 * employee, bad project, duplicate) never blocks the valid rows around it.
 * created_by is always the caller's own session identity — never read from
 * the file — same as every other backoffice-authed write in this app.
 */
async function processBulkUpload(buffer, createdByEmpId) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = parseUploadedWorkbook(workbook);

  if (rows.length === 0) {
    throw new TaskValidationError(400, 'No data rows found in the uploaded file.');
  }

  const [employeesResult, projectsResult] = await Promise.all([
    pool.query('SELECT "EmpId" AS emp_id, "EmpStatus" AS status FROM employees'),
    pool.query('SELECT project_code FROM projects'),
  ]);
  const employeeStatusByEmpId = new Map(employeesResult.rows.map((r) => [r.emp_id, r.status]));
  const projectCodes = new Set(projectsResult.rows.map((r) => r.project_code));

  const created = [];
  const errors = [];

  for (const { rowNumber, cells } of rows) {
    const result = validateBulkRow(cells, { employeeStatusByEmpId, projectCodes });

    if (!result.valid) {
      errors.push({ row: rowNumber, emp_id: result.empId, reason: result.reason });
      continue;
    }

    try {
      const task = await createTask({
        emp_id: result.task.emp_id,
        project_code: result.task.project_code,
        priority: result.task.priority,
        description: result.task.description,
        location_site: result.task.location_site,
        source: 'backoffice',
        created_by: createdByEmpId,
        taskDate: result.task.taskDate,
      });
      created.push(task);
    } catch (err) {
      const reason = err instanceof TaskValidationError ? err.message : 'unexpected error creating the task';
      errors.push({ row: rowNumber, emp_id: result.task.emp_id, reason });
    }
  }

  return { created, errors, totalRows: rows.length };
}

module.exports = { buildTaskTemplateWorkbook, processBulkUpload, TEMPLATE_COLUMNS };
