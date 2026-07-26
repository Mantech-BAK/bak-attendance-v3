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
 *   POST /api/punches          — punch in/out. Body keys the backend actually reads:
 *                                 { emp_id, type, project_code, lat, lng, entered_by?, device_ref?, recorded_at? }
 *                                 There is no task_id column on punches — only project_code, so the
 *                                 selected task's project_code must be sent, not its id.
 *
 * ASSUMED — not specified by the requirement, invented here so the
 * supervisor UI has something concrete to target. Confirm/adjust shape
 * with backend before relying on it:
 *   GET  /api/punches/pending?manager_emp_id=
 *   POST /api/punches/:id/approve
 *   POST /api/punches/:id/reject
 *   GET  /api/employees/direct-reports?manager_emp_id=
 *   POST /api/tasks
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
    throw new Error(message);
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
export function submitPunch({ empId, type, projectCode, lat, lng }) {
  return request('/api/punches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emp_id: empId,
      type,
      project_code: projectCode ?? null,
      lat,
      lng,
      recorded_at: new Date().toISOString(),
    }),
  });
}

// ASSUMED
export function fetchPendingApprovals(managerEmpId) {
  return request(`/api/punches/pending?manager_emp_id=${encodeURIComponent(managerEmpId)}`);
}

// ASSUMED
export function approvePunch(punchId) {
  return request(`/api/punches/${encodeURIComponent(punchId)}/approve`, { method: 'POST' });
}

// ASSUMED
export function rejectPunch(punchId) {
  return request(`/api/punches/${encodeURIComponent(punchId)}/reject`, { method: 'POST' });
}

// ASSUMED
export function fetchDirectReports(managerEmpId) {
  return request(`/api/employees/direct-reports?manager_emp_id=${encodeURIComponent(managerEmpId)}`);
}

// ASSUMED
export function createTask({ title, description, assignedEmpId, dueDate, createdBy }) {
  return request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description,
      assigned_emp_id: assignedEmpId,
      due_date: dueDate,
      created_by: createdBy,
    }),
  });
}
