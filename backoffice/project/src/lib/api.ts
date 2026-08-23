import { getToken, clearSession, AUTH_EXPIRED_EVENT } from './session';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';

// Carries the HTTP status and parsed body of a failed request so callers
// that need to react to a specific status (e.g. 409 duplicate warnings)
// don't have to re-parse err.message — mirrors mobile/src/api/client.js's
// same pattern.
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    // 401 = missing/invalid/expired token; 403 = a previously-valid session
    // that no longer passes the backend's authorization re-check (e.g. the
    // org chart changed). Either way, drop the stale session and let
    // AuthProvider bounce back to the login screen.
    if (res.status === 401 || res.status === 403) {
      clearSession();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError((body && body.error) || `Request to ${path} failed (${res.status})`, res.status, body);
  }
  return body as T;
}

export function backofficeLogin(empId: string, loginCode: string): Promise<{ token: string; emp_id: string; name: string }> {
  return request('/api/auth/backoffice-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_id: empId, login_code: loginCode }),
  });
}

export type Employee = {
  emp_id: string;
  name: string;
  company: string | null;
  department: string | null;
  designation: string | null;
  reporting_manager_emp_id: string | null;
  status: string;
  ot_eligible: string | null;
  // TEMPORARY TESTING MEASURE — typed-code identification standing in for
  // face capture (see backend/src/routes/punch.js). Testers need to see an
  // employee's code to log in as them from the mobile app.
  login_code: string | null;
  created_at: string;
};

export type Project = {
  project_code: string;
  project_name: string | null;
  company: string | null;
  status: string;
  cost_center: string | null;
};

export type Task = {
  id: number;
  emp_id: string;
  employee_name: string | null;
  project_code: string | null;
  project_name: string | null;
  task_date: string;
  priority: string | null;
  description: string;
  location_site: string | null;
  status: string;
  source: string;
  created_by: string;
  created_at: string;
};

export type Punch = {
  id: number;
  emp_id: string;
  employee_name: string | null;
  employee_designation: string | null;
  project_code: string | null;
  project_name: string | null;
  punch_time: string;
  lat: number;
  lng: number;
  entry_method: string;
  entered_by: string;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  resolved_address: string | null;
  created_at: string;
};

export type ExceptionRow = {
  id: number;
  type: string;
  emp_id: string | null;
  employee_name: string | null;
  employee_designation: string | null;
  ref_table: string | null;
  ref_id: number | null;
  details: string;
  status: string;
  created_at: string;
  // Only populated when ref_table === 'punches' (currently just
  // single_punch_only) — the existing incomplete punch's project/time, so
  // "Add Punch" can pre-fill everything but the missing timestamp.
  ref_project_code: string | null;
  ref_punch_time: string | null;
};

export type AttendanceSession = {
  emp_id: string;
  project_code: string | null;
  date: string;
  punch_count: number;
  punch_in: { id: number; punch_time: string };
  punch_out: { id: number; punch_time: string } | null;
  incomplete: boolean;
  // worked_minutes is the RAW punch_in-to-punch_out span — do NOT use it to
  // display or sum "hours worked" when another project's session can nest
  // inside this one's span (see applyNestedSubtraction in the backend).
  // counted_minutes is worked_minutes minus any nested project's time
  // already subtracted server-side, and is what should always be shown.
  worked_minutes: number | null;
  counted_minutes: number | null;
  nested_within: string | null;
  threshold_minutes: number;
  threshold_source: 'ramzan' | 'daily_override' | 'global_default';
  is_overtime: boolean | null;
  overtime_minutes: number | null;
};

export function fetchEmployees(): Promise<Employee[]> {
  return request('/api/employees');
}

export function regenerateLoginCode(empId: string): Promise<{ emp_id: string; login_code: string }> {
  return request(`/api/employees/${encodeURIComponent(empId)}/login-code/regenerate`, {
    method: 'POST',
  });
}

export type UpdateEmployeeResult = {
  emp_id: string;
  name: string;
  status: string;
  login_code: string | null;
  ot_eligible: 'Y' | 'N';
  reporting_manager_emp_id: string | null;
};

// currentEmpId addresses the row being edited (the URL path param); newEmpId
// is what EmpId should become — usually the same value, but can differ when
// the admin is renaming it. Safe to rename even for an employee with
// existing punches/tasks: the backend's ON UPDATE CASCADE migration
// propagates it everywhere automatically in one statement.
export function updateEmployee(currentEmpId: string, input: {
  newEmpId: string;
  name: string;
  status: string;
  loginCode: string | null;
  otEligible: boolean;
  reportingManagerEmpId: string | null;
}): Promise<UpdateEmployeeResult> {
  return request(`/api/employees/${encodeURIComponent(currentEmpId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      new_emp_id: input.newEmpId,
      name: input.name,
      status: input.status,
      login_code: input.loginCode,
      ot_eligible: input.otEligible,
      reporting_manager_emp_id: input.reportingManagerEmpId,
    }),
  });
}

export function fetchProjects(status?: string): Promise<Project[]> {
  return request(`/api/projects${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export function fetchTasks(): Promise<Task[]> {
  return request('/api/tasks');
}

export function tasksExportUrl(date: string): string {
  return `${API_BASE_URL}/api/tasks/export?date=${encodeURIComponent(date)}`;
}

export function tasksTemplateUrl(): string {
  return `${API_BASE_URL}/api/tasks/template`;
}

export type BulkTaskUploadError = { row: number; emp_id: string; reason: string };
export type BulkTaskUploadResult = { created: Task[]; errors: BulkTaskUploadError[]; totalRows: number };

// Multipart, not JSON — request() only ever sets an Authorization header
// (never Content-Type) so it's safe to reuse here too: the browser sets its
// own multipart boundary on the FormData body automatically.
export function uploadTasksBulk(file: File): Promise<BulkTaskUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  return request('/api/tasks/bulk-upload', {
    method: 'POST',
    body: formData,
  });
}

export type PunchableProject = { project_code: string; is_default: boolean };

// Powers the Add Punch modal's project restriction — only a project the
// employee has a real task for on that date, or their department default if
// none, never an arbitrary project.
export function fetchPunchableProjects(empId: string, date: string): Promise<{ projects: PunchableProject[] }> {
  return request(`/api/tasks/punchable-projects?emp_id=${encodeURIComponent(empId)}&date=${encodeURIComponent(date)}`);
}

// Both export/report downloads are backoffice-only routes behind
// requireBackofficeAuth, but they're fetched directly (for blob handling)
// rather than through request() above, so callers must attach this
// themselves.
export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// created_by is never sent — the backend derives it from the session token.
export function createTask(input: {
  empId: string;
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string | null;
}): Promise<Task> {
  return request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: input.empId,
      project_code: input.projectCode,
      priority: input.priority,
      description: input.description,
      location_site: input.locationSite,
      source: 'backoffice',
    }),
  });
}

export function fetchPunches(): Promise<Punch[]> {
  return request('/api/punches');
}

// Admin-only manual punch correction — auto-approved immediately, no review
// queue. punchTime is the admin-supplied explicit timestamp (never "now").
// entered_by is never sent — the backend derives it from the session token.
// force skips the backend's near-duplicate check (used on the confirmed
// resubmit after the admin has seen and accepted the warning). projectCode
// is mandatory — the backend rejects a missing one with a 400, matching the
// UI which never lets the form reach Submit without one selected.
export function addAdminPunchCorrection(input: {
  empId: string;
  projectCode: string;
  punchTime: string;
  force?: boolean;
}): Promise<Punch> {
  return request('/api/punches/admin-correction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: input.empId,
      project_code: input.projectCode,
      punch_time: input.punchTime,
      force: input.force ?? false,
    }),
  });
}

export function fetchExceptions(): Promise<ExceptionRow[]> {
  return request('/api/exceptions');
}

export function resolveException(id: number): Promise<ExceptionRow> {
  return request(`/api/exceptions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  });
}

export function fetchAttendance(date?: string): Promise<{ sessions: AttendanceSession[]; exceptions_raised: unknown[] }> {
  return request(`/api/attendance${date ? `?date=${encodeURIComponent(date)}` : ''}`);
}

export type OtApproval = {
  id: number;
  emp_id: string;
  employee_name: string;
  employee_designation: string | null;
  work_date: string;
  worked_minutes: number;
  threshold_minutes: number;
  ot_minutes: number;
  status: string;
};

// Unscoped (no supervisor_emp_id) — every pending OT approval org-wide, for
// the Dashboard's Overtime Alerts card. Reuses the existing end-of-day OT
// evaluation as its detection mechanism (see backend otApprovals service);
// this is just surfacing that already-computed result, not a new
// calculation or a real-time mid-shift check.
export function fetchAllPendingOtApprovals(): Promise<OtApproval[]> {
  return request('/api/ot-approvals/pending');
}

export function confirmationSheetUrl(date: string): string {
  return `${API_BASE_URL}/api/reports/confirmation-sheet?date=${encodeURIComponent(date)}`;
}

export type DailyWorkingHours = {
  date: string;
  hours: number | null;
};

export type RamzanPeriod = {
  start_date: string;
  end_date: string;
  declared_by: string;
  declared_at: string;
};

export function fetchDailyWorkingHours(): Promise<DailyWorkingHours> {
  return request('/api/settings/daily-working-hours');
}

export function saveDailyWorkingHours(hours: number): Promise<DailyWorkingHours> {
  return request('/api/settings/daily-working-hours', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
}

export function fetchRamzanPeriods(): Promise<{ periods: RamzanPeriod[] }> {
  return request('/api/settings/ramzan-periods');
}

export function declareRamzanPeriod(input: { start_date: string; end_date: string }): Promise<{ periods: RamzanPeriod[] }> {
  return request('/api/settings/ramzan-periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export type RamzanWorkingHours = {
  minutes: number | null;
  hours: number | null;
};

export function fetchRamzanWorkingHours(): Promise<RamzanWorkingHours> {
  return request('/api/settings/ramzan-working-hours');
}

export function saveRamzanWorkingHours(hours: number): Promise<RamzanWorkingHours> {
  return request('/api/settings/ramzan-working-hours', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
}

export type DuplicatePunchWindow = {
  minutes: number;
};

export function fetchDuplicatePunchWindow(): Promise<DuplicatePunchWindow> {
  return request('/api/settings/duplicate-punch-window');
}

export function saveDuplicatePunchWindow(minutes: number): Promise<DuplicatePunchWindow> {
  return request('/api/settings/duplicate-punch-window', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes }),
  });
}

// Destructive — wipes punches/tasks/exceptions/ot_approvals/confirmation_sheet_records.
// Never touches employees/projects or any other master data. The literal
// 'RESET' confirm value is a second safety net behind the UI's own confirm
// dialog, matched server-side.
export function resetTestData(): Promise<{ cleared: string[] }> {
  return request('/api/settings/reset-test-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESET' }),
  });
}
