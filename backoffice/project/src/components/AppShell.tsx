import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Clock,
  Building2,
  BarChart3,
  LogOut,
  AlertTriangle,
  Settings,
  CheckSquare,
  CalendarOff,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useRouter, type RouteName } from '@/lib/router';
import { cn, initials } from '@/lib/utils';
import { ScrollToTopButton } from './ScrollToTopButton';

const NAV: { name: RouteName; label: string; icon: typeof LayoutDashboard }[] = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'employees', label: 'Employees', icon: Users },
  { name: 'tasks', label: 'Tasks', icon: ClipboardList },
  { name: 'punches', label: 'Punches', icon: Clock },
  { name: 'approvals', label: 'Approvals', icon: CheckSquare },
  { name: 'projects', label: 'Projects', icon: Building2 },
  { name: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { name: 'reported-leaves', label: 'Reported Leaves', icon: CalendarOff },
  { name: 'reports', label: 'Reports', icon: BarChart3 },
  { name: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const { route, navigate } = useRouter();

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* sticky + self-start + h-screen (2026-09-23) — without self-start, a
          flex child defaults to align-items: stretch and gets forced to
          match <main>'s full (often page-length) height, at which point
          "sticky" has nothing left to stick within and the sidebar scrolls
          away with the page exactly like a plain "relative" one would. */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 self-start flex-col border-r border-slate-200/80 bg-white shadow-[1px_0_0_rgba(15,23,42,0.02),4px_0_24px_-8px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition-transform duration-200 hover:scale-105">
            <img src="/Screenshot_2026-07-15_102148.png" alt="BAK Mantech" className="h-7 w-auto object-contain" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-slate-900">BAK Mantech</p>
            <p className="bg-gradient-to-r from-teal-600 to-sky-600 bg-clip-text text-[11px] font-bold uppercase tracking-wider text-transparent">V3 Admin</p>
          </div>
        </div>

        <div className="mx-5 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {NAV.map((item) => {
            const active = route.name === item.name;
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.name)}
                className={cn(
                  'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-out',
                  active
                    ? 'bg-gradient-to-r from-teal-50 to-teal-50/40 text-teal-700 shadow-sm shadow-teal-900/5'
                    : 'text-slate-600 hover:translate-x-0.5 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-teal-500 to-sky-500 transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                    active ? 'bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-600/40' : 'text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-600',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          {session && (
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-slate-50">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-600 text-xs font-bold text-white shadow-sm shadow-teal-600/30 ring-2 ring-white">
                {initials(session.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{session.name}</p>
                <p className="truncate text-xs text-slate-400">{session.empId}</p>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-700"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400">
              <LogOut className="h-[18px] w-[18px]" />
            </span>
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/70">
        <div className="mx-auto max-w-7xl px-8 py-10">{children}</div>
      </main>

      <ScrollToTopButton />
    </div>
  );
}
