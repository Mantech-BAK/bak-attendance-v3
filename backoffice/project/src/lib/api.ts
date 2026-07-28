const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.error) || `Request to ${path} failed (${res.status})`);
  }
  return body as T;
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
  created_at: string;
};

export type Project = {
  project_code: string;
  project_name: string | null;
  company: string | null;
  status: string;
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
  resolved_area: string | null;
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
};

export type AttendanceSession = {
  emp_id: string;
  project_code: string | null;
  date: string;
  punch_count: number;
  punch_in: { id: number; punch_time: string };
  punch_out: { id: number; punch_time: string } | null;
  incomplete: boolean;
};

export function fetchEmployees(): Promise<Employee[]> {
  return request('/api/employees');
}

export function fetchProjects(status?: string): Promise<Project[]> {
  return request(`/api/projects${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export function fetchTasks(): Promise<Task[]> {
  return request('/api/tasks');
}

export function createTask(input: {
  empId: string;
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string | null;
  createdBy: string;
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
      created_by: input.createdBy,
    }),
  });
}

export function fetchPunches(): Promise<Punch[]> {
  return request('/api/punches');
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

export function fetchAttendance(): Promise<{ sessions: AttendanceSession[]; exceptions_raised: unknown[] }> {
  return request('/api/attendance');
}
