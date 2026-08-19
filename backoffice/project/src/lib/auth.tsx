import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { backofficeLogin } from './api';
import { loadSession, saveSession, clearSession, AUTH_EXPIRED_EVENT, type Session } from './session';

type AuthState = {
  session: Session | null;
  isAuthenticated: boolean;
  // Throws (with the server's message, e.g. "You do not have access to
  // this system.") on bad credentials or a valid-but-unauthorized employee —
  // the two are indistinguishable by design, see backend routes/auth.js.
  login: (empId: string, loginCode: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  // Fired by api.ts whenever any request comes back 401/403 — covers both
  // an expired/invalid token and a previously-authorized employee who no
  // longer passes the backend's per-request authorization re-check.
  useEffect(() => {
    function handleExpired() {
      setSession(null);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  const login = useCallback(async (empId: string, loginCode: string) => {
    const result = await backofficeLogin(empId, loginCode);
    const next: Session = { token: result.token, empId: result.emp_id, name: result.name };
    saveSession(next);
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, isAuthenticated: !!session, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
