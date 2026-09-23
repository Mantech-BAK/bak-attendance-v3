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
  // Admin-set flag, decoupled from designation/job title — real designations
  // are things like "Operations Manager", never literally "Supervisor", so
  // this is what actually gates supervisor-only behavior everywhere (mobile
  // role switching, backoffice access, punch auto-approval), not designation.
  is_supervisor: boolean;
  // Fallback identification alongside Face ID (see backend/src/routes/punch.js).
  // Testers/admins need to see an employee's code to log in as them from the
  // mobile app when Face ID isn't registered or available.
  login_code: string | null;
  created_at: string;
  has_face_registered: boolean;
  // Raw FK codes, alongside the already-joined display names above
  // (department/designation/company) — the edit form's dropdowns need the
  // code to pre-select the right option, not just the friendly name shown
  // everywhere else. department itself has no separate code: EmpDeptId
  // stores department_name directly (see routes/employees.js).
  division_code: string | null;
  designation_code: string | null;
  religion_code: string | null;
  religion: string | null;
  cpr: string | null;
};

export type DepartmentRef = { department_name: string; company_dept_id: string | null; default_project_code: string | null };
export type DesignationRef = { designation_code: string; designation_name: string };
export type DivisionRef = { division_code: string; division_name: string };
export type ReligionRef = { religion_code: string; religion_name: string };

export function fetchDepartments(): Promise<DepartmentRef[]> {
  return request('/api/departments');
}

export function fetchDesignations(): Promise<DesignationRef[]> {
  return request('/api/designations');
}

export function fetchDivisions(): Promise<DivisionRef[]> {
  return request('/api/divisions');
}

export function fetchReligions(): Promise<ReligionRef[]> {
  return request('/api/religions');
}

export type Project = {
  project_code: string;
  project_name: string | null;
  company: string | null;
  status: string;
  cost_center: string | null;
};

export type Task = {
  id: number;
  // Human-readable TASK-DDMMYYYY-XXX reference id, auto-assigned at
  // creation — never manually entered, purely a display/reference id
  // distinct from the internal `id`.
  display_id: string;
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
  // Punches against this task's id, rejected ones excluded — drives the
  // Tasks page's Completed/Pending/Not Started tabs: 0 = Not Started, odd =
  // Pending, even & non-zero = Completed.
  punch_count: number;
  // Controls which date this task's session reports under on the
  // Confirmation Sheet once punched (2026-09-14) — 'regular' (the default,
  // punch-IN date) or 'night' (punch-OUT date instead).
  shift_type: 'regular' | 'night';
};

export type Punch = {
  id: number;
  emp_id: string;
  employee_name: string | null;
  employee_designation: string | null;
  project_code: string | null;
  project_name: string | null;
  // Set when this punch is against a real task (its project_code is that
  // task's own project, auto-filled server-side) — null for the
  // department-default fallback (no real task assigned that day).
  task_id: number | null;
  task_display_id: string | null;
  task_description: string | null;
  punch_time: string;
  // Required for mobile/supervisor-app punches (2026-08-30) — but a
  // backoffice admin-added punch (entry_method 'admin_correction') never
  // has real device GPS behind it, so still genuinely null there.
  lat: number | null;
  lng: number | null;
  entry_method: string;
  entered_by: string;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  resolved_address: string | null;
  // Mandatory closing note the employee (or, via Scan Team Member, the
  // supervisor) types when giving the OUT punch (2026-09-14) — null on an
  // opening punch, always. Also settable from the backoffice's own Add
  // Punch, mandatory there under the same rule.
  out_remark: string | null;
  // In/out task photo (2026-09-14) — photo_path is the private-bucket
  // storage path (never used directly); photo_url is a short-lived signed
  // URL generated fresh on every GET /api/punches, null once it's actually
  // expired even if photo_path is set (shouldn't happen within one page
  // load, but don't assume). is_in_punch tells which of the two photo
  // columns this row's photo (if any) belongs under — true for the task's
  // first punch, false for its second, null for a non-task (fallback) punch.
  photo_path: string | null;
  photo_uploaded_at: string | null;
  photo_url: string | null;
  is_in_punch: boolean | null;
  created_at: string;
  // Manually granted on top of the automatic OT calculation, at the moment
  // a closing (OUT) punch was approved (2026-09-14) — its own audit trail,
  // separate from approved_by/approved_at above (which just mean "this
  // punch itself is legitimate", not "extra OT was granted here").
  extra_ot_minutes: number | null;
  extra_ot_granted_by: string | null;
  extra_ot_granted_at: string | null;
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
  // single_punch_only) — the existing incomplete punch's task/project/time,
  // so "Add Punch" can pre-fill everything but the missing timestamp.
  ref_project_code: string | null;
  ref_task_id: number | null;
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

// Clears an employee's registered Face ID, re-enabling "Register Your Face"
// for them on mobile. See backend/src/routes/employees.js's /:emp_id/face/reset.
export function resetFaceId(empId: string): Promise<{ emp_id: string }> {
  return request(`/api/employees/${encodeURIComponent(empId)}/face/reset`, {
    method: 'POST',
  });
}

export type UpdateEmployeeResult = {
  emp_id: string;
  name: string;
  status: string;
  login_code: string | null;
  ot_eligible: 'Y' | 'N';
  is_supervisor: boolean;
  reporting_manager_emp_id: string | null;
  department: string | null;
  designation_code: string | null;
  division_code: string | null;
  religion_code: string | null;
  cpr: string | null;
  designation: string | null;
  company: string | null;
  religion: string | null;
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
  isSupervisor: boolean;
  reportingManagerEmpId: string | null;
  department: string | null;
  designationCode: string | null;
  divisionCode: string | null;
  religionCode: string | null;
  cpr: string | null;
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
      is_supervisor: input.isSupervisor,
      reporting_manager_emp_id: input.reportingManagerEmpId,
      department: input.department,
      designation_code: input.designationCode,
      division_code: input.divisionCode,
      religion_code: input.religionCode,
      cpr: input.cpr,
    }),
  });
}

export function fetchProjects(status?: string): Promise<Project[]> {
  return request(`/api/projects${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export function fetchTasks(): Promise<Task[]> {
  return request('/api/tasks');
}

// No date = every task (Tasks page); with a date = that day only (Reports).
export function tasksExportUrl(date?: string): string {
  return `${API_BASE_URL}/api/tasks/export${date ? `?date=${encodeURIComponent(date)}` : ''}`;
}

// No date = every punch (Punches page); with a date = that day only (Reports).
export function punchesExportUrl(date?: string): string {
  return `${API_BASE_URL}/api/punches/export${date ? `?date=${encodeURIComponent(date)}` : ''}`;
}

export function attendanceExportUrl(date: string): string {
  return `${API_BASE_URL}/api/attendance/export?date=${encodeURIComponent(date)}`;
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

export type PunchableTask = {
  id: number | null;
  display_id: string | null;
  project_code: string;
  name: string;
  priority: string | null;
  status: string;
  is_default: boolean;
};

// Powers the Add Punch modal's task picker — only a task the employee is
// actually assigned on that date, or their department default if none,
// never an arbitrary task/project. Not deduped by project — two tasks
// sharing a project are two separate selections (punches track task_id).
// open_task_id/open_project_code (2026-09-14) name whichever one is
// currently open for this employee on this date, if any — lets Add Punch
// tell whether the punch it's about to add would be a CLOSING one, to
// require the closing remark. A hint only; POST /admin-correction
// re-derives and enforces the same fact server-side regardless.
export function fetchPunchableTasks(empId: string, date: string): Promise<{
  tasks: PunchableTask[];
  open_task_id: number | null;
  open_project_code: string | null;
}> {
  return request(`/api/tasks/punchable-tasks?emp_id=${encodeURIComponent(empId)}&date=${encodeURIComponent(date)}`);
}

// Both export/report downloads are backoffice-only routes behind
// requireBackofficeAuth, but they're fetched directly (for blob handling)
// rather than through request() above, so callers must attach this
// themselves.
export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fetches an authenticated .xlsx export and triggers the browser download.
// Throws an Error carrying the server's message on failure.
export async function downloadExport(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// created_by is never sent — the backend derives it from the session token.
export function createTask(input: {
  empId: string;
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string | null;
  isOutdoor?: boolean;
  shiftType?: 'regular' | 'night';
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
      ...(input.isOutdoor !== undefined ? { is_outdoor: input.isOutdoor } : {}),
      ...(input.shiftType !== undefined ? { shift_type: input.shiftType } : {}),
    }),
  });
}

export type BulkAssignTaskError = { emp_id: string; reason: string };
export type BulkAssignTaskResult = { created: Task[]; errors: BulkAssignTaskError[]; totalRequested: number };

// One identical task assigned to multiple employees at once from the Create
// Task form's multi-select picker — creates one row per empId, partial
// success (a duplicate/validation failure for one employee never blocks the
// others). created_by is never sent — the backend derives it from the
// session token, same as createTask above.
export function assignTaskBulk(input: {
  empIds: string[];
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string | null;
  isOutdoor?: boolean;
  shiftType?: 'regular' | 'night';
}): Promise<BulkAssignTaskResult> {
  return request('/api/tasks/bulk-assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_ids: input.empIds,
      project_code: input.projectCode,
      priority: input.priority,
      description: input.description,
      location_site: input.locationSite,
      ...(input.isOutdoor !== undefined ? { is_outdoor: input.isOutdoor } : {}),
      ...(input.shiftType !== undefined ? { shift_type: input.shiftType } : {}),
    }),
  });
}

// Admin-only task edit — same validation as creating one (project must
// exist, description required, the emp_id+day+project+description
// duplicate rule). emp_id is never editable — reassigning to a different
// employee isn't a correction, it's a different task.
export function updateTask(id: number, input: {
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string | null;
  taskDate: string;
}): Promise<Task> {
  return request(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_code: input.projectCode,
      priority: input.priority,
      description: input.description,
      location_site: input.locationSite,
      task_date: input.taskDate,
    }),
  });
}

// Real, permanent removal — the backend rejects this (409) if any punch
// already references the task, and the frontend must gate this behind an
// explicit confirmation dialog before calling it.
export function deleteTask(id: number): Promise<void> {
  return request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Corrects which project a task itself is linked to — leaves priority/
// description/location_site/task_date untouched (2026-09-22). Powers the
// Edit Punch modal's Project field: the punch's own task_id never changes,
// but the task's project_code does, and the backend syncs that onto every
// punch already recorded against this task too, not just this response.
// Blocked (409) only once BOTH of the task's punches are already approved
// — a deliberately looser rule than updateTask's, specifically so this
// still works while the punch you're looking at is itself still pending.
export function updateTaskProject(taskId: number, projectCode: string): Promise<{ task: Task; punches_updated: number }> {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/project`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_code: projectCode }),
  });
}

export function fetchPunches(): Promise<Punch[]> {
  return request('/api/punches');
}

// Admin-only manual punch correction — auto-approved immediately, no review
// queue. punchTime is the admin-supplied explicit timestamp (never "now").
// entered_by is never sent — the backend derives it from the session token.
// force skips the backend's near-duplicate check (used on the confirmed
// resubmit after the admin has seen and accepted the warning). Exactly one
// of taskId/projectCode is mandatory — the backend rejects neither being
// present with a 400, matching the UI which never lets the form reach
// Submit without a task (or fallback project) selected.
// outRemark is mandatory whenever this punch is a closing one (see
// fetchPunchableTasks' open_task_id/open_project_code) — the backend
// rejects both a missing remark on a close and a present one on an open.
export function addAdminPunchCorrection(input: {
  empId: string;
  taskId?: number | null;
  projectCode?: string | null;
  punchTime: string;
  outRemark?: string | null;
  force?: boolean;
}): Promise<Punch> {
  return request('/api/punches/admin-correction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: input.empId,
      task_id: input.taskId ?? null,
      project_code: input.taskId ? null : (input.projectCode ?? null),
      punch_time: input.punchTime,
      out_remark: input.outRemark ?? undefined,
      force: input.force ?? false,
    }),
  });
}

// Admin-only punch edit — task/project only. punch_time is never sent here
// (2026-09-22) and never accepted by the backend either way — the recorded
// punch time is permanent, editable by no one, at no stage, approved or
// not. Only what the punch was FOR can still be corrected before approval.
// Same validation as creating one (keyed off the punch's own real,
// unchangeable time), with this punch's own id excluded from every check.
// emp_id is never editable — a different employee is a different punch,
// not a correction.
export function updatePunch(id: number, input: {
  taskId?: number | null;
  projectCode?: string | null;
  force?: boolean;
}): Promise<Punch> {
  return request(`/api/punches/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: input.taskId ?? null,
      project_code: input.taskId ? null : (input.projectCode ?? null),
      force: input.force ?? false,
    }),
  });
}

// Real, permanent removal — the frontend must gate this behind an explicit
// confirmation dialog before calling it.
export function deletePunch(id: number): Promise<void> {
  return request(`/api/punches/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

// "Clear Exceptions" (2026-09-23) — resolves every currently open exception
// in one action. Only ever touches open ones; already-resolved rows are
// left exactly as they were.
export function resolveAllExceptions(): Promise<{ resolved: number }> {
  return request('/api/exceptions/resolve-all', { method: 'POST' });
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

// Item 3 — backoffice approval, reusing the exact same mobile-supervisor
// endpoints (GET /pending, PATCH .../approve, PATCH .../reject) rather than
// separate ones: request() already attaches this session's Bearer token to
// every call, and the backend resolves that into a company-wide scope
// (GET /pending with no supervisor_emp_id) or a bypass of the
// reporting-manager check (approve/reject) whenever a valid backoffice
// session is present — see routes/punches.js and routes/otApprovals.js.
export type PendingPunch = {
  id: number;
  emp_id: string;
  employee_name: string | null;
  project_code: string | null;
  project_name: string | null;
  task_id: number | null;
  task_display_id: string | null;
  punch_time: string;
  entry_method: string;
  entered_by: string;
  // True for a task's opening punch, false for its closing (OUT) punch, null
  // for the department-default fallback (no real task) — extra OT can only
  // ever be granted on a closing punch (2026-09-14).
  is_in_punch: boolean | null;
};

export function fetchAllPendingPunches(): Promise<PendingPunch[]> {
  return request('/api/punches/pending');
}

// Full Punch shape for a single punch — backs the Approvals page's Edit
// action (2026-09-23), which reuses AddPunchModal exactly as the Punches
// page's Edit Punch does. PendingPunch above doesn't carry the fields
// AddPunchModal needs (task_description, out_remark, photo, etc.), so this
// fetches the same full row GET /api/punches (list) already returns, just
// for one id instead of the whole table.
export function fetchPunchById(id: number): Promise<Punch> {
  return request(`/api/punches/${encodeURIComponent(id)}`);
}

export function approvePunchAdmin(id: number, extraOtMinutes?: number): Promise<Punch> {
  return request(`/api/punches/${encodeURIComponent(id)}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(extraOtMinutes ? { extra_ot_minutes: extraOtMinutes } : {}),
  });
}

export function rejectPunchAdmin(id: number, reason: string): Promise<Punch> {
  return request(`/api/punches/${encodeURIComponent(id)}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export function approveOtApprovalAdmin(id: number): Promise<OtApproval> {
  return request(`/api/ot-approvals/${encodeURIComponent(id)}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function rejectOtApprovalAdmin(id: number, reason: string): Promise<OtApproval> {
  return request(`/api/ot-approvals/${encodeURIComponent(id)}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export function confirmationSheetUrl(date: string): string {
  return `${API_BASE_URL}/api/reports/confirmation-sheet?date=${encodeURIComponent(date)}`;
}

export type DailyWorkingHours = {
  date: string;
  hours: number | null;
};

export type RamzanPeriod = {
  id: string;
  start_date: string;
  end_date: string;
  declared_by: string;
  declared_at: string;
  active: boolean;
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

// Edits dates and/or toggles active — pass only the fields changing.
// Unlike declaring a new period, editing does NOT enforce "start_date
// cannot be earlier than today" (a correction needs to work on periods
// that already started or already ended). Never retroactively touches
// confirmation_sheet_records/ot_approvals already generated for dates in
// this period — only future report generation reflects the change.
export function updateRamzanPeriod(id: string, input: { start_date?: string; end_date?: string; active?: boolean }): Promise<{ periods: RamzanPeriod[] }> {
  return request(`/api/settings/ramzan-periods/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteRamzanPeriod(id: string): Promise<void> {
  return request(`/api/settings/ramzan-periods/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

export type SummerBanPeriod = {
  id: string;
  start_date: string;
  end_date: string;
  declared_by: string;
  declared_at: string;
  active: boolean;
};

export function fetchSummerBanPeriods(): Promise<{ periods: SummerBanPeriod[] }> {
  return request('/api/settings/summer-ban-periods');
}

export function declareSummerBanPeriod(input: { start_date: string; end_date: string }): Promise<{ periods: SummerBanPeriod[] }> {
  return request('/api/settings/summer-ban-periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateSummerBanPeriod(id: string, input: { start_date?: string; end_date?: string; active?: boolean }): Promise<{ periods: SummerBanPeriod[] }> {
  return request(`/api/settings/summer-ban-periods/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteSummerBanPeriod(id: string): Promise<void> {
  return request(`/api/settings/summer-ban-periods/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

// Item 4 — the nightly window an employee can create a task for themselves
// from mobile with no supervisor/backoffice involved. Times are plain
// 24-hour "HH:MM" strings, compared server-side in UTC (see
// isWithinEmergencyWindow in the backend's settings service).
export type EmergencyTimeAllowance = {
  start: string;
  end: string;
};

export function fetchEmergencyTimeAllowance(): Promise<EmergencyTimeAllowance> {
  return request('/api/settings/emergency-time-allowance');
}

export function saveEmergencyTimeAllowance(start: string, end: string): Promise<EmergencyTimeAllowance> {
  return request('/api/settings/emergency-time-allowance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start, end }),
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

// Report Leave (2026-09-23) — submitted from the mobile app only; the
// backoffice's "Reported Leaves" page is read-only (view + photo download),
// same spirit as it never creates punches directly either.
export type LeaveReport = {
  id: number;
  emp_id: string;
  employee_name: string | null;
  employee_designation: string | null;
  leave_date: string;
  leave_type: string;
  remarks: string | null;
  photo_path: string | null;
  photo_uploaded_at: string | null;
  photo_url: string | null;
  reported_by: string;
  created_at: string;
};

export function fetchLeaveReports(): Promise<LeaveReport[]> {
  return request('/api/leaves');
}
