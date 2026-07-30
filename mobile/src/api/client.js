import { File, UploadType } from 'expo-file-system';
import { API_BASE_URL } from '../config';

/**
 * Endpoint contract status:
 *
 * CONFIRMED (built on backend, response shapes verified against it):
 *   POST /api/punch/identify   — multipart face image -> matched employee + today's tasks
 *                                 response: { emp_id, name, designation, tasks: [{ id, project_code, name, priority, status }] }
 *                                 note: matching is currently an exact-byte-hash stub, not real
 *                                 face recognition — will not match a live camera capture against
 *                                 a prior registration photo until a real matcher is wired in.
 *   POST /api/punches          — records a punch. Body keys the backend actually reads:
 *                                 { emp_id, project_code, lat, lng, entered_by? }
 *                                 There is no "type" (IN/OUT) at capture time — it's derived later,
 *                                 at attendance-calculation time, from punch_time ordering within a
 *                                 day (earliest = IN, latest = OUT). punch_time is set server-side
 *                                 from the moment the request is received — never accepted from the
 *                                 client. There is no task_id column on punches — only project_code,
 *                                 so the selected task's project_code must be sent, not its id.
 *                                 When entered_by differs from emp_id (a supervisor punching on
 *                                 behalf of someone), the backend verifies emp_id's
 *                                 reporting_manager_emp_id actually equals entered_by — 403 otherwise.
 *                                 Only auto-approved when entered_by's designation is "Supervisor".
 *                                 409 if emp_id already has a different project open today (odd punch
 *                                 count) — error.body.open_project_code names which one; punching that
 *                                 same open project again (to close it) is always allowed.
 *   GET   /api/punches/today-status?emp_id=   — { open_project_code: string|null } — which project (if
 *                                 any) is currently open for that employee today. A client-side hint
 *                                 only; POST /api/punches re-checks this server-side regardless.
 *   GET   /api/attendance/:emp_id   — computed IN/OUT sessions grouped by project+day for that employee
 *                                 response: { emp_id, sessions: [{ project_code, date, punch_count,
 *                                 punch_in: {id, punch_time}, punch_out: {id, punch_time}|null, incomplete }],
 *                                 exceptions_raised: [...] } — a single-punch day raises a
 *                                 'single_punch_only' exception (visible to the supervisor) rather
 *                                 than guessing IN vs OUT.
 *   GET   /api/punches/pending?supervisor_emp_id=   — pending punches for direct reports of that supervisor
 *                                 response: [{ id, emp_id, employee_name, project_code, punch_time, lat, lng, entry_method, entered_by }]
 *   PATCH /api/punches/:id/approve   body: { supervisor_emp_id }
 *   PATCH /api/punches/:id/reject    body: { supervisor_emp_id, reason }
 *                                 Both verify supervisor_emp_id is actually that punch's employee's
 *                                 reporting manager (403 otherwise) and that the punch is still
 *                                 'pending' (409 if already approved/rejected).
 *   GET   /api/employees/direct-reports?supervisor_emp_id=
 *                                 response: [{ emp_id, name, designation, department, status }]
 *   POST  /api/tasks            body: { emp_id, project_code, priority?, description, location_site?, source, created_by }
 *                                 source must be one of: supervisor_app | backoffice | teams
 *   GET   /api/projects         response: [{ project_code, project_name, company, status }] (OPEN only)
 *   GET   /api/ot-approvals/pending?supervisor_emp_id=   — pending OT approvals for direct reports
 *                                 response: [{ id, emp_id, employee_name, work_date, worked_minutes,
 *                                 threshold_minutes, ot_minutes, status }] — a distinct concept from
 *                                 punch approvals (day-level total OT, computed by a nightly job or
 *                                 by generating the backoffice confirmation-sheet report for that day).
 *   PATCH /api/ot-approvals/:id/approve   body: { supervisor_emp_id }
 *   PATCH /api/ot-approvals/:id/reject    body: { supervisor_emp_id, reason }
 *                                 Same verification pattern as punch approve/reject (403 if not the
 *                                 employee's reporting manager, 409 if already resolved).
 */

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const body = await parseJsonSafe(response);

  if (!response.ok) {
    const message = body?.error || `Request to ${path} failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

// CONFIRMED
//
// Deliberately NOT using fetch()+FormData here: on this SDK/RN version,
// appending a { uri, name, type } file part to FormData and posting it via
// fetch throws "Unsupported FormDataPart implementation" on Android before
// the request ever reaches the network (confirmed against a live emulator;
// matches an open, unresolved upstream issue — expo/expo#33134). Using
// expo-file-system's upload task instead bypasses fetch/FormData entirely.
export async function identifyPunch(photoUri) {
  const file = new File(photoUri);
  const task = file.createUploadTask(`${API_BASE_URL}/api/punch/identify`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'face',
    mimeType: 'image/jpeg',
  });

  const result = await task.uploadAsync();
  const body = result?.body ? JSON.parse(result.body) : null;

  if (!result || result.status < 200 || result.status >= 300) {
    const message = body?.error || `Request to /api/punch/identify failed (${result?.status})`;
    throw new Error(message);
  }

  return body;
}

// DEV ONLY — remove this function and its call site in PunchScreen.js once
// real face recognition replaces the exact-hash stub in faceMatch.js. Hits
// GET /api/dev/identify-bypass/:emp_id, which skips face matching entirely.
export function devIdentifyBypass(empId) {
  return request(`/api/dev/identify-bypass/${encodeURIComponent(empId)}`);
}

// CONFIRMED
export function submitPunch({ empId, projectCode, lat, lng, enteredBy }) {
  return request('/api/punches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: empId,
      project_code: projectCode ?? null,
      lat,
      lng,
      entered_by: enteredBy ?? undefined,
    }),
  });
}

// CONFIRMED
export function fetchAttendance(empId) {
  return request(`/api/attendance/${encodeURIComponent(empId)}`);
}

// CONFIRMED
export function fetchTodayPunchStatus(empId) {
  return request(`/api/punches/today-status?emp_id=${encodeURIComponent(empId)}`);
}

// CONFIRMED
export function fetchPendingApprovals(supervisorEmpId) {
  return request(`/api/punches/pending?supervisor_emp_id=${encodeURIComponent(supervisorEmpId)}`);
}

// CONFIRMED
export function approvePunch(punchId, supervisorEmpId) {
  return request(`/api/punches/${encodeURIComponent(punchId)}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisor_emp_id: supervisorEmpId }),
  });
}

// CONFIRMED
export function rejectPunch(punchId, supervisorEmpId, reason) {
  return request(`/api/punches/${encodeURIComponent(punchId)}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisor_emp_id: supervisorEmpId, reason }),
  });
}

// CONFIRMED
export function fetchDirectReports(supervisorEmpId) {
  return request(`/api/employees/direct-reports?supervisor_emp_id=${encodeURIComponent(supervisorEmpId)}`);
}

// CONFIRMED
export function createTask({ assignedEmpId, projectCode, priority, description, locationSite, createdBy }) {
  return request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: assignedEmpId,
      project_code: projectCode,
      priority,
      description,
      location_site: locationSite,
      source: 'supervisor_app',
      created_by: createdBy,
    }),
  });
}

// CONFIRMED
export function fetchProjects() {
  return request('/api/projects?status=OPEN');
}

// CONFIRMED
export function fetchPendingOtApprovals(supervisorEmpId) {
  return request(`/api/ot-approvals/pending?supervisor_emp_id=${encodeURIComponent(supervisorEmpId)}`);
}

// CONFIRMED
export function approveOt(otApprovalId, supervisorEmpId) {
  return request(`/api/ot-approvals/${encodeURIComponent(otApprovalId)}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisor_emp_id: supervisorEmpId }),
  });
}

// CONFIRMED
export function rejectOt(otApprovalId, supervisorEmpId, reason) {
  return request(`/api/ot-approvals/${encodeURIComponent(otApprovalId)}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisor_emp_id: supervisorEmpId, reason }),
  });
}
