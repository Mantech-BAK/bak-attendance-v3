import { useEffect, useMemo, useState } from 'react';
import { Clock, ClipboardList, Users, Building2, TrendingUp, CalendarSearch } from 'lucide-react';
import { fetchEmployees, fetchTasks, fetchProjects, fetchAttendance } from '@/lib/api';
import type { Employee, Task, Project, AttendanceSession } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, Input, EmptyState } from '@/components/ui';
import { cn, initials, formatDateTime } from '@/lib/utils';

function yesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type ReportData = {
  employees: Employee[];
  tasks: Task[];
  projects: Project[];
  sessions: AttendanceSession[];
};

function sessionHours(session: AttendanceSession): number {
  if (!session.punch_out) return 0;
  const ms = new Date(session.punch_out.punch_time).getTime() - new Date(session.punch_in.punch_time).getTime();
  return ms / (1000 * 60 * 60);
}

export function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const [dateQuery, setDateQuery] = useState(yesterday());
  const [dateSessions, setDateSessions] = useState<AttendanceSession[] | null>(null);
  const [dateLoading, setDateLoading] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [employees, tasks, projects, attendance] = await Promise.all([
        fetchEmployees(),
        fetchTasks(),
        fetchProjects(),
        fetchAttendance(),
      ]);
      setData({ employees, tasks, projects, sessions: attendance.sessions });
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    async function loadForDate() {
      if (!dateQuery) return;
      setDateLoading(true);
      setDateError(null);
      try {
        const result = await fetchAttendance(dateQuery);
        setDateSessions(result.sessions);
      } catch (err) {
        setDateError(err instanceof Error ? err.message : 'Could not load attendance for this date.');
        setDateSessions(null);
      } finally {
        setDateLoading(false);
      }
    }
    loadForDate();
  }, [dateQuery]);

  const employeeMap = useMemo(() => new Map((data?.employees ?? []).map((e) => [e.emp_id, e])), [data]);
  const projectMap = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.project_code, p])), [data]);

  const hoursPerProject = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const s of data.sessions) {
      if (!s.punch_out || !s.project_code) continue;
      map.set(s.project_code, (map.get(s.project_code) ?? 0) + sessionHours(s));
    }
    return Array.from(map.entries())
      .map(([code, hrs]) => ({ project: projectMap.get(code)?.project_name ?? code, hours: hrs }))
      .sort((a, b) => b.hours - a.hours);
  }, [data, projectMap]);

  const maxProjectHours = Math.max(...hoursPerProject.map((h) => h.hours), 1);

  const hoursPerEmployee = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const s of data.sessions) {
      if (!s.punch_out) continue;
      map.set(s.emp_id, (map.get(s.emp_id) ?? 0) + sessionHours(s));
    }
    return Array.from(map.entries())
      .map(([empId, hrs]) => ({ employee: employeeMap.get(empId), hours: hrs }))
      .filter((e) => e.employee)
      .sort((a, b) => b.hours - a.hours);
  }, [data, employeeMap]);

  const taskStatusCounts = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const t of data.tasks) {
      map.set(t.status, (map.get(t.status) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const taskPriorityCounts = useMemo(() => {
    if (!data) return { high: 0, medium: 0, low: 0 };
    return data.tasks.reduce(
      (acc, t) => {
        const key = t.priority as keyof typeof acc;
        if (key in acc) acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      { high: 0, medium: 0, low: 0 },
    );
  }, [data]);

  const deptHeadcount = useMemo(() => {
    if (!data) return [];
    const departments = Array.from(new Set(data.employees.map((e) => e.department).filter(Boolean))) as string[];
    return departments.map((d) => ({
      name: d,
      count: data.employees.filter((e) => e.department === d).length,
    }));
  }, [data]);

  if (loading || !data) {
    return (
      <>
        <PageHeader title="Reports" subtitle="Insights across attendance and operations" />
        <Spinner />
      </>
    );
  }

  const totalHours = hoursPerEmployee.reduce((s, e) => s + e.hours, 0);
  const totalPunches = data.sessions.reduce((s, session) => s + session.punch_count, 0);

  return (
    <>
      <PageHeader title="Reports" subtitle="Insights across attendance and operations" />

      <Card className="mb-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <CalendarSearch className="h-5 w-5 text-slate-400" />
          <h2 className="text-base font-semibold text-slate-900">Attendance for a Specific Date</h2>
        </div>

        <div className="mb-5 max-w-xs">
          <Input value={dateQuery} onChange={setDateQuery} label="Date" id="attendance-date-query" type="date" />
        </div>

        {dateLoading ? (
          <Spinner />
        ) : dateError ? (
          <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {dateError}
          </div>
        ) : !dateSessions || dateSessions.length === 0 ? (
          <EmptyState icon={<CalendarSearch className="h-6 w-6" />} title="No sessions on this date" message="No punches were recorded for any employee on the selected date." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Project</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Punch In</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Punch Out</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Worked</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Threshold</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Overtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dateSessions.map((s, i) => {
                  const emp = employeeMap.get(s.emp_id);
                  const proj = s.project_code ? projectMap.get(s.project_code) : null;
                  return (
                    <tr key={`${s.emp_id}-${s.project_code}-${i}`} className="transition hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{emp?.name ?? s.emp_id}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{proj?.project_name ?? s.project_code ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{formatDateTime(s.punch_in.punch_time)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{s.punch_out ? formatDateTime(s.punch_out.punch_time) : <span className="text-slate-400">Incomplete</span>}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{s.worked_minutes !== null ? `${(s.worked_minutes / 60).toFixed(1)}h` : '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{(s.threshold_minutes / 60).toFixed(1)}h <span className="text-xs text-slate-400">({s.threshold_source.replace(/_/g, ' ')})</span></td>
                      <td className="px-4 py-3">
                        {s.is_overtime ? (
                          <Badge variant="warning">+{((s.overtime_minutes ?? 0) / 60).toFixed(1)}h OT</Badge>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Employees', value: data.employees.length, icon: Users, color: 'teal' },
          { label: 'Total Tasks', value: data.tasks.length, icon: ClipboardList, color: 'sky' },
          { label: 'Total Punches', value: totalPunches, icon: Clock, color: 'amber' },
          { label: 'Total Hours Logged', value: `${totalHours.toFixed(1)}h`, icon: TrendingUp, color: 'slate' },
        ].map((s) => {
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
                  <p className="mt-2 text-2xl font-bold text-slate-900">{s.value}</p>
                </div>
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', colorMap[s.color])}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Hours by Project</h2>
          </div>
          {hoursPerProject.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No completed punch sessions yet.</p>
          ) : (
            <div className="space-y-4">
              {hoursPerProject.map((h) => (
                <div key={h.project}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{h.project}</span>
                    <span className="text-slate-500">{h.hours.toFixed(1)}h</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-teal-500 transition-all duration-500" style={{ width: `${(h.hours / maxProjectHours) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Task Status Breakdown</h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {taskStatusCounts.map(([status, count]) => (
              <div key={status} className="rounded-xl border border-slate-100 p-4 text-center">
                <p className="text-2xl font-bold text-slate-900">{count}</p>
                <Badge variant="info">{status}</Badge>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By Priority</p>
            <div className="flex gap-2">
              <Badge variant="error">High: {taskPriorityCounts.high}</Badge>
              <Badge variant="warning">Medium: {taskPriorityCounts.medium}</Badge>
              <Badge variant="neutral">Low: {taskPriorityCounts.low}</Badge>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Hours by Employee</h2>
          </div>
          {hoursPerEmployee.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No completed punch sessions yet.</p>
          ) : (
            <ul className="space-y-3">
              {hoursPerEmployee.map((h) => (
                <li key={h.employee!.emp_id} className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {initials(h.employee!.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{h.employee!.name}</p>
                    <p className="text-xs text-slate-400">{h.employee!.designation ?? '—'}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{h.hours.toFixed(1)}h</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Headcount by Department</h2>
          </div>
          <div className="space-y-3">
            {deptHeadcount.map((d) => {
              const pct = data.employees.length ? (d.count / data.employees.length) * 100 : 0;
              return (
                <div key={d.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{d.name}</span>
                    <span className="text-slate-500">{d.count}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
