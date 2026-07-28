import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const TOKEN_KEY = 'bak_admin_token';
const PLACEHOLDER_TOKEN = 'bak-admin-dev-token';

type AuthState = {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);
  }, []);

  const login = useCallback((submittedToken: string) => {
    if (submittedToken.trim() === PLACEHOLDER_TOKEN) {
      localStorage.setItem(TOKEN_KEY, submittedToken.trim());
      setToken(submittedToken.trim());
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, isAuthenticated: !!token, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
