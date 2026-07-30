import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Clock,
  BarChart3,
  LogOut,
  AlertTriangle,
  Settings,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useRouter, type RouteName } from '@/lib/router';
import { cn } from '@/lib/utils';

const NAV: { name: RouteName; label: string; icon: typeof LayoutDashboard }[] = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'employees', label: 'Employees', icon: Users },
  { name: 'tasks', label: 'Tasks', icon: ClipboardList },
  { name: 'punches', label: 'Punches', icon: Clock },
  { name: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { name: 'reports', label: 'Reports', icon: BarChart3 },
  { name: 'confirmation-sheet', label: 'Confirmation Sheet', icon: FileSpreadsheet },
  { name: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const { route, navigate } = useRouter();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-6 py-5">
          <img src="/Screenshot_2026-07-15_102148.png" alt="BAK Mantech" className="h-10 w-auto object-contain" />
          <p className="text-xs font-semibold text-teal-600">V3 Admin</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => {
            const active = route.name === item.name;
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.name)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                  active
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon className={cn('h-5 w-5', active ? 'text-teal-600' : 'text-slate-400')} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-5 w-5 text-slate-400" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
