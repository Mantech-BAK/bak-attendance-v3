import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type RouteName = 'dashboard' | 'employees' | 'tasks' | 'punches' | 'approvals' | 'projects' | 'exceptions' | 'reported-leaves' | 'reports' | 'settings' | 'employee-edit';

// empId is only set for 'employee-edit' (hash: #/employees/<empId>/edit).
export type Route = { name: RouteName; empId?: string };

type RouterState = {
  route: Route;
  navigate: (name: RouteName, empId?: string) => void;
};

const RouterContext = createContext<RouterState | undefined>(undefined);

function parseHash(): Route {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  const editMatch = /^employees\/(.+)\/edit$/.exec(hash);
  if (editMatch) {
    return { name: 'employee-edit', empId: decodeURIComponent(editMatch[1]) };
  }
  const valid: RouteName[] = ['dashboard', 'employees', 'tasks', 'punches', 'approvals', 'projects', 'exceptions', 'reported-leaves', 'reports', 'settings'];
  if (valid.includes(hash as RouteName)) {
    return { name: hash as RouteName };
  }
  return { name: 'dashboard' };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((name: RouteName, empId?: string) => {
    if (name === 'employee-edit' && empId) {
      window.location.hash = `/employees/${encodeURIComponent(empId)}/edit`;
      setRoute({ name, empId });
      return;
    }
    window.location.hash = `/${name}`;
    setRoute({ name });
  }, []);

  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
