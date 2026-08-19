// Single source of truth for the backoffice's stored session — read by
// api.ts (to attach the Authorization header) and lib/auth.tsx (React
// state), without those two importing each other.

const TOKEN_KEY = 'bak_backoffice_token';
const EMP_ID_KEY = 'bak_backoffice_emp_id';
const NAME_KEY = 'bak_backoffice_name';

// Dispatched by api.ts whenever a request comes back 401/403 — the token is
// missing, invalid, expired, or the employee no longer passes the backend's
// per-request authorization re-check (e.g. the org chart changed under
// them). AuthProvider listens for this to drop back to the login screen.
export const AUTH_EXPIRED_EVENT = 'bak-backoffice-auth-expired';

export type Session = { token: string; empId: string; name: string };

export function loadSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const empId = localStorage.getItem(EMP_ID_KEY);
  if (!token || !empId) return null;
  return { token, empId, name: localStorage.getItem(NAME_KEY) ?? empId };
}

export function saveSession(session: Session): void {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(EMP_ID_KEY, session.empId);
  localStorage.setItem(NAME_KEY, session.name);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMP_ID_KEY);
  localStorage.removeItem(NAME_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
