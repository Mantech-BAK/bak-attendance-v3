import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { backofficeLogin } from './api';
import { loadSession, saveSession, clearSession, AUTH_EXPIRED_EVENT, type Session } from './session';

type AuthState = {
  session: Session | null;
  isAuthenticated: boolean;
  // True only until the initial localStorage check (below) has actually
  // run — distinct from isAuthenticated being false because there really
  // is no session. Without this, every page load/refresh briefly (and on
  // a slow connection, not-so-briefly — the whole dashboard's own data
  // then has to re-fetch from scratch once the real session lands) renders
  // the Login form first regardless of a valid stored session, since
  // session starts as null and is only restored inside a useEffect (after
  // the first render). Confirmed 2026-09-16 as the actual cause behind a
  // hard refresh "looking stuck" — there was no real hang, just an
  // unindicated multi-second flash back to the login screen. App.tsx uses
  // this to show a neutral loading state instead during that gap.
  isInitializing: boolean;
  // Throws (with the server's message, e.g. "You do not have access to
  // this system.") on bad credentials or a valid-but-unauthorized employee —
  // the two are indistinguishable by design, see backend routes/auth.js.
  login: (empId: string, loginCode: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    setSession(loadSession());
    setIsInitializing(false);
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
    <AuthContext.Provider value={{ session, isAuthenticated: !!session, isInitializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
