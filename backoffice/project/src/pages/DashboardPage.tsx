import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  ClipboardList,
  Clock,
  Building2,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  Timer,
} from 'lucide-react';
import { fetchEmployees, fetchTasks, fetchPunches, fetchProjects, fetchExceptions, fetchAllPendingOtApprovals } from '@/lib/api';
import type { Employee, Task, Punch, Project, ExceptionRow, OtApproval } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState } from '@/components/ui';
import { MonthCalendar } from '@/components/MonthCalendar';
import { cn, formatDate, formatDateTime, initials } from '@/lib/utils';

function dateKeyOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type Stats = {
  employees: Employee[];
  tasks: Task[];
  punches: Punch[];
  projects: Project[];
  exceptions: ExceptionRow[];
  otApprovals: OtApproval[];
};

export function DashboardPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  // Defaults to today — every widget below reads through this single date
  // rather than the whole loaded range. Clicking a calendar day reassigns
  // it; nothing is ever summed across multiple days at once.
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  useEffect(() => {
    async function load() {
      const [employees, tasks, punches, projects, exceptions, otApprovals] = await Promise.all([
        fetchEmployees(),
        fetchTasks(),
        fetchPunches(),
        fetchProjects(),
        fetchExceptions(),
        fetchAllPendingOtApprovals(),
      ]);
      setData({ employees, tasks, punches, projects, exceptions, otApprovals });
      setLoading(false);
    }
    load();
  }, []);

  const activityByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of data?.punches ?? []) {
      const key = dateKeyOf(p.punch_time);
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [data]);

  // Every widget on this page is derived from this one object. Switching
  // selectedDate recomputes it from scratch from the full already-loaded
  // lists — nothing here is ever aggregated across more than one day.
  const scoped = useMemo(() => {
    if (!data) return null;

    const dayPunches = data.punches.filter((p) => dateKeyOf(p.punch_time) === selectedDate);
    const dayTasks = data.tasks.filter((t) => dateKeyOf(t.task_date) === selectedDate);
    const dayExceptions = data.exceptions.filter((e) => dateKeyOf(e.created_at) === selectedDate);

    const presentEmpIds = new Set(dayPunches.map((p) => p.emp_id));
    const presentEmployees = data.employees.filter((e) => presentEmpIds.has(e.emp_id));

    const departments = Array.from(new Set(presentEmployees.map((e) => e.department).filter(Boolean))) as string[];

    return { dayPunches, dayTasks, dayExceptions, presentEmployees, departments };
  }, [data, selectedDate]);

  if (loading || !data || !scoped) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Overview of attendance and operations" />
        <Spinner />
      </>
    );
  }

  const isToday = selectedDate === todayKey();

  // Status-based counts — deliberately NOT scoped to selectedDate. These
  // reflect employees.status / projects.status directly, independent of
  // whether anyone punched on the day currently selected on the calendar.
  const activeEmployees = data.employees.filter((e) => e.status === 'active').length;
  const activeProjects = data.projects.filter((p) => p.status === 'OPEN').length;

  const statCards = [
    { label: 'Active Employees', value: activeEmployees, icon: Users, color: 'teal' },
    { label: 'Total Tasks', value: scoped.dayTasks.length, icon: ClipboardList, color: 'sky' },
    { label: 'Total Punches', value: scoped.dayPunches.length, icon: Clock, color: 'amber' },
    { label: 'Open Projects', value: activeProjects, icon: Building2, color: 'slate' },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Showing ${formatDate(selectedDate)}${isToday ? ' (today)' : ''} — click any day on the calendar to view its own numbers.`}
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge variant={isToday ? 'accent' : 'info'}>{isToday ? 'Today' : formatDate(selectedDate)}</Badge>
        {!isToday && (
          <button
            type="button"
            onClick={() => setSelectedDate(todayKey())}
            className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline"
          >
            Back to today
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          const colorMap: Record<string, string> = {
            teal: 'bg-teal-50 text-teal-600',
            sky: 'bg-sky-50 text-sky-600',
            amber: 'bg-amber-50 text-amber-600',
            slate: 'bg-slate-100 text-slate-600',
          };
          return (
            <Card key={s.label} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">{s.label}</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{s.value}</p>
                </div>
                <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', colorMap[s.color])}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Calendar</h2>
          </div>
          <MonthCalendar
            activityByDate={activityByDate}
            selectedDate={selectedDate}
            onDayPress={(key) => setSelectedDate(key)}
          />
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Timer className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-semibold text-slate-900">Overtime Alerts</h2>
            {data.otApprovals.length > 0 && <Badge variant="warning">{data.otApprovals.length}</Badge>}
            <span className="text-xs font-normal text-slate-400">— all pending, any date</span>
          </div>
          {data.otApprovals.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>No one has exceeded their working hours.</span>
            </div>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {data.otApprovals.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{o.employee_name}</p>
                    <p className="text-xs text-amber-700">{o.work_date} · {(o.worked_minutes / 60).toFixed(1)}h worked of {(o.threshold_minutes / 60).toFixed(1)}h</p>
                  </div>
                  <Badge variant="warning">+{(o.ot_minutes / 60).toFixed(1)}h</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Recent Tasks</h2>
          </div>
          {scoped.dayTasks.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No tasks on this date" message="Tasks for the selected day will appear here." />
          ) : (
            <ul className="space-y-3">
              {scoped.dayTasks.slice(0, 10).map((t) => {
                const priorityVariant = t.priority === 'high' ? 'error' : t.priority === 'medium' ? 'warning' : 'neutral';
                return (
                  <li key={t.id} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-slate-200 hover:bg-slate-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                      {t.employee_name ? initials(t.employee_name) : '—'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{t.description}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge variant={priorityVariant}>{t.priority ?? 'none'}</Badge>
                        <Badge variant="info">{t.status}</Badge>
                        <span className="text-xs text-slate-400">{t.employee_name ?? 'Unassigned'}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Recent Punches</h2>
          </div>
          {scoped.dayPunches.length === 0 ? (
            <EmptyState icon={<Clock className="h-6 w-6" />} title="No punches on this date" message="Time entries for the selected day will appear here." />
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>Name</span>
                <span>Status</span>
              </div>
              <ul className="space-y-3">
                {scoped.dayPunches.slice(0, 10).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-slate-200 hover:bg-slate-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                      {p.employee_name ? initials(p.employee_name) : '—'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{p.employee_name ?? 'Unknown'}</p>
                      <p className="truncate text-xs text-slate-500">{p.project_name ?? 'No project'}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant={p.approval_status === 'approved' ? 'success' : p.approval_status === 'rejected' ? 'error' : 'warning'}>
                        {p.approval_status}
                      </Badge>
                      <p className="mt-1 text-xs text-slate-400">{formatDateTime(p.punch_time)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-slate-400" />
          <h2 className="text-base font-semibold text-slate-900">Department Overview</h2>
        </div>
        {scoped.departments.length === 0 ? (
          <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="No one present on this date" message="Department breakdown reflects who punched in on the selected day." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scoped.departments.map((d) => {
              const count = scoped.presentEmployees.filter((e) => e.department === d).length;
              const pct = scoped.presentEmployees.length ? (count / scoped.presentEmployees.length) * 100 : 0;
              return (
                <div key={d} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">{d}</p>
                    <span className="text-sm font-semibold text-slate-900">{count}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-900">Needs Attention</h2>
        </div>
        <div className="space-y-2">
          {scoped.dayExceptions.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {e.employee_name && <strong>{e.employee_name}: </strong>}
                {e.details}
              </span>
            </div>
          ))}
          {scoped.dayExceptions.length === 0 && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All clear — no exceptions raised on this date.</span>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
