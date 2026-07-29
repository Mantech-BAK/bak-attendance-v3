/**
 * STUB — replace with real ARTIFY API calls once credentials arrive.
 *
 * Real implementation should call ARTIFY's endpoints for employees,
 * departments, projects, and job codes, then normalize the response into
 * the shape below. Departments are a standalone list, keyed by
 * (company, department_name) — job-code info is still folded into the
 * employee/project records since there's no standalone job_code table.
 */

const FAKE_EMPLOYEES = [
  ['E1001', 'Amina Yusuf', 'BAK Holdings', 'Engineering', 'Software Engineer', 'E1005', 'active', 'Y'],
  ['E1002', 'Chidi Okafor', 'BAK Holdings', 'Engineering', 'QA Analyst', 'E1005', 'active', 'Y'],
  ['E1003', 'Fatima Bello', 'BAK Logistics', 'Operations', 'Fleet Coordinator', 'E1006', 'active', 'N'],
  ['E1004', 'Tunde Adebayo', 'BAK Logistics', 'Operations', 'Warehouse Supervisor', 'E1006', 'active', 'Y'],
  ['E1005', 'Ngozi Eze', 'BAK Holdings', 'Engineering', 'Engineering Manager', 'E1007', 'active', 'N'],
  ['E1006', 'Musa Ibrahim', 'BAK Logistics', 'Operations', 'Operations Manager', 'E1007', 'active', 'N'],
  ['E1007', 'Grace Nwosu', 'BAK Holdings', 'Executive', 'COO', null, 'active', 'N'],
  ['E1008', 'Segun Alabi', 'BAK Logistics', 'Finance', 'Payroll Officer', 'E1007', 'inactive', 'N'],
];

const FAKE_PROJECTS = [
  ['PRJ-001', 'Lagos Warehouse Expansion', 'BAK Holdings', 'OPEN'],
  ['PRJ-002', 'Fleet Telemetry Rollout', 'BAK Logistics', 'OPEN'],
  ['PRJ-003', 'Payroll System Migration', 'BAK Holdings', 'CLOSED'],
];

// Company-scoped: the same department_name can exist independently under
// different companies (a real scenario across BAK's multiple companies),
// so (company, department_name) together is the identity ARTIFY sends —
// there is no separate department_code in the source system.
const FAKE_DEPARTMENTS = [
  ['BAK Holdings', 'Engineering'],
  ['BAK Holdings', 'Executive'],
  ['BAK Logistics', 'Finance'],
  ['BAK Logistics', 'Operations'],
];

const EMPLOYEE_FIELDS = [
  'emp_id', 'name', 'company', 'department',
  'designation', 'reporting_manager_emp_id', 'status', 'ot_eligible',
];

const PROJECT_FIELDS = ['project_code', 'project_name', 'company', 'status'];

const DEPARTMENT_FIELDS = ['company', 'department_name'];

function rowToObject(fields, row) {
  return fields.reduce((obj, field, i) => {
    obj[field] = row[i];
    return obj;
  }, {});
}

/**
 * STUB — pulls employees, departments, projects, and job codes from ARTIFY.
 * Returns realistic fake data until real API credentials are available.
 */
async function fetchArtifyData() {
  // Simulate network latency of a real API call.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    departments: FAKE_DEPARTMENTS.map((row) => rowToObject(DEPARTMENT_FIELDS, row)),
    employees: FAKE_EMPLOYEES.map((row) => rowToObject(EMPLOYEE_FIELDS, row)),
    projects: FAKE_PROJECTS.map((row) => rowToObject(PROJECT_FIELDS, row)),
  };
}

module.exports = { fetchArtifyData };
