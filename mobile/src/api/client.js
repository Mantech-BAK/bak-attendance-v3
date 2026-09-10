import { API_BASE_URL } from '../config';

/**
 * Endpoint contract status:
 *
 * CONFIRMED (built on backend, response shapes verified against it):
 *   POST /api/punch/identify   — typed { emp_id, login_code } identification — the fallback
 *                                 path, always available alongside identify-face below.
 *                                 response: { emp_id, name, designation, is_supervisor, tasks: [{ id, project_code, name,
 *                                 priority, status, punch_count, task_status }] } — task_status is
 *                                 not_started/pending/completed; a completed (2-punch) task stays in
 *                                 this list (unpunchable, shown Closed) rather than being dropped.
 *                                 401 with a generic "Invalid employee ID or code." on any mismatch.
 *   POST /api/punch/identify-face   — 1:N open face identification, no emp_id submitted.
 *                                 body: { embedding: number[192] } (on-device MobileFaceNet embedding)
 *                                 same response shape as /identify; 401 { error: 'Face not recognized.' }
 *                                 on no match — UI falls back to typed code, same as any other failure.
 *   POST /api/punch/verify-face   — 1:1 re-validation ("is this still emp_id's face"), distinct
 *                                 from /identify-face's open 1:N search above. Used immediately
 *                                 before every self-punch (item 2, 2026-09-10).
 *                                 body: { emp_id, embedding: number[192] }
 *                                 200 { matched: true } on match; 401 { error: 'Face not recognized...' }
 *                                 otherwise. Doesn't itself grant anything — POST /api/punches
 *                                 independently re-verifies the same embedding.
 *   POST /api/employees/:emp_id/face-embeddings   — self-service face registration (only
 *                                 callable once per employee; 409 if EmpFaceId is already set).
 *                                 body: { embeddings: number[][] } (3-4 on-device embeddings, one per angle)
 *                                 response: { emp_id, registered_by, registered_at }
 *   POST /api/punches          — records a punch. Body keys the backend actually reads:
 *                                 { emp_id, task_id, project_code, lat, lng, entered_by?,
 *                                 revalidation_face_embedding?, revalidation_login_code? }
 *                                 A self-punch (entered_by === emp_id, or omitted) is rejected with
 *                                 401 unless revalidation_face_embedding or revalidation_login_code is
 *                                 present and matches emp_id — re-proven fresh immediately before
 *                                 every single punch (item 2, 2026-09-10). Does not apply to the
 *                                 supervisor on-behalf path (entered_by !== emp_id) — see below.
 *                                 There is no "type" (IN/OUT) at capture time — it's derived later,
 *                                 at attendance-calculation time, from punch_time ordering within a
 *                                 day (earliest = IN, latest = OUT). punch_time is set server-side
 *                                 from the moment the request is received — never accepted from the
 *                                 client. task_id is the real task's id when the employee has one (its
 *                                 project is auto-resolved server-side, never trust a client-sent
 *                                 project_code alongside it); project_code alone is only for the
 *                                 department-default fallback (no real task assigned that day — see
 *                                 identify's is_default tasks).
 *                                 When entered_by differs from emp_id (a supervisor punching on
 *                                 behalf of someone), the backend verifies emp_id's
 *                                 reporting_manager_emp_id actually equals entered_by — 403 otherwise.
 *                                 Only auto-approved when entered_by's is_supervisor flag is true.
 *                                 409 if the SAME task (or, for the fallback, the same project) isn't
 *                                 what's currently open — error.body.open_task_id/open_project_code
 *                                 names what is. Two different real tasks — even sharing a project —
 *                                 never block each other; only the fallback project enforces "one open
 *                                 at a time", same as before per-task tracking existed.
 *   GET   /api/punches/today-status?emp_id=   — { open_task_id: number|null, open_project_code:
 *                                 string|null } — which task (or, for the fallback, project) is
 *                                 currently open for that employee today. A client-side hint only;
 *                                 POST /api/punches re-checks this server-side regardless.
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
 *   GET   /api/punches/history?emp_id=   — read-only punch history (any approval status, most
 *                                 recent first, capped at 200) for this employee, plus their direct
 *                                 reports' if they're a supervisor — no approve/reject action lives
 *                                 on this endpoint, view-only. A regular employee has no direct
 *                                 reports, so this naturally returns only their own punches.
 *                                 response: [{ id, emp_id, employee_name, project_code, project_name,
 *                                 task_id, task_display_id, punch_time, entry_method, entered_by,
 *                                 approval_status, rejection_reason }]
 *   GET   /api/employees/:emp_id   — single employee's full record, for the Profile tab
 *                                 response: { emp_id, name, company, department, designation,
 *                                 reporting_manager_emp_id, status, ot_eligible, login_code, created_at }
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
export function identifyPunch(empId, loginCode) {
  return request('/api/punch/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_id: empId, login_code: loginCode }),
  });
}

// CONFIRMED — taskId is the real task's id (its project is resolved
// server-side); for the department-default fallback (no real task), pass
// projectCode instead and leave taskId null/undefined.
//
// revalidationFaceEmbedding/revalidationLoginCode (item 2, 2026-09-10): a
// self-punch (empId === enteredBy, or enteredBy omitted) is rejected with
// 401 unless one of these is present and matches empId — re-proven fresh
// immediately before every single punch, never reused across punches. Only
// applies to self-punches; the supervisor "Scan Team Member" on-behalf path
// (enteredBy !== empId) is unchanged and needs neither field.
export function submitPunch({ empId, taskId, projectCode, lat, lng, enteredBy, revalidationFaceEmbedding, revalidationLoginCode }) {
  return request('/api/punches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: empId,
      task_id: taskId ?? null,
      project_code: projectCode ?? null,
      lat,
      lng,
      entered_by: enteredBy ?? undefined,
      revalidation_face_embedding: revalidationFaceEmbedding ?? undefined,
      revalidation_login_code: revalidationLoginCode ?? undefined,
    }),
  });
}

// Item 2 (2026-09-10) — 1:1 re-validation ("is this still empId's face"),
// distinct from identifyByFace's open 1:N search below. Used to give the
// re-validation capture UI fast pass/fail feedback before attaching the
// same embedding to the actual punch request, which independently
// re-verifies it — this call alone never grants access to punch anything.
export function verifyFace(empId, embedding) {
  return request('/api/punch/verify-face', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_id: empId, embedding }),
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

// CONFIRMED — works for both a supervisor (self + team) and a regular
// employee (self only, since they have no direct reports).
export function fetchPunchHistory(empId) {
  return request(`/api/punches/history?emp_id=${encodeURIComponent(empId)}`);
}

// CONFIRMED
export function fetchEmployee(empId) {
  return request(`/api/employees/${encodeURIComponent(empId)}`);
}

// Face ID — same response shape as identifyPunch, so callers can feed the
// result straight into the same apply-functions either path uses.
export function identifyByFace(embedding) {
  return request('/api/punch/identify-face', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embedding }),
  });
}

export function registerFaceEmbeddings(empId, embeddings) {
  return request(`/api/employees/${encodeURIComponent(empId)}/face-embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeddings }),
  });
}

// CONFIRMED — source defaults to 'supervisor_app' (a supervisor assigning
// to a direct report, unchanged); item 4's self-service emergency flow
// passes 'employee_self' instead, with assignedEmpId === createdBy.
export function createTask({ assignedEmpId, projectCode, priority, description, locationSite, createdBy, source }) {
  return request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: assignedEmpId,
      project_code: projectCode,
      priority,
      description,
      location_site: locationSite,
      source: source || 'supervisor_app',
      created_by: createdBy,
    }),
  });
}

// CONFIRMED
export function fetchProjects() {
  return request('/api/projects?status=OPEN');
}

// Refreshes one employee's punch-selection task list (self or, from a
// supervisor's on-behalf flow, the team member currently being punched for)
// without a full re-identify — same shape/filtering as identifyPunch's own
// tasks field. Used to pick up a task created (or completed) mid-session
// promptly, instead of only ever refreshing at login/scan time.
export function fetchMyPunchableTasks(empId) {
  return request(`/api/tasks/me/${encodeURIComponent(empId)}`).then((r) => r.tasks);
}

// Item 4 — lets the "Create Task" button on My Tasks show/hide itself
// without a wasted round trip to POST /api/tasks just to discover the
// window is closed.
export function fetchEmergencyWindow() {
  return request('/api/punch/emergency-window');
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
