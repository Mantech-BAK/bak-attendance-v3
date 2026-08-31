import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Briefcase, Building2, Eye, EyeOff, RefreshCw, Pencil, ScanFace, List, LayoutGrid } from 'lucide-react';
import { fetchEmployees, fetchTasks, regenerateLoginCode, resetFaceId } from '@/lib/api';
import type { Employee, Task } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState, Select, Button } from '@/components/ui';
import { EditEmployeeModal } from '@/components/EditEmployeeModal';
import { EmployeeTasksModal } from '@/components/EmployeeTasksModal';
import { punchStatus } from '@/pages/TasksPage';
import { initials, cn } from '@/lib/utils';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type TaskCounts = { total: number; completed: number; pending: number; notStarted: number };

const EMPTY_COUNTS: TaskCounts = { total: 0, completed: 0, pending: 0, notStarted: 0 };

export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useState<'list' | 'bar'>('list');
  const [taskDate, setTaskDate] = useState(today());
  const [tasksEmployee, setTasksEmployee] = useState<Employee | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [resettingFaceId, setResettingFaceId] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  function toggleRevealed(empId: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });
  }

  async function handleRegenerate(empId: string) {
    if (!window.confirm(`Regenerate ${empId}'s login code? Their current code will stop working immediately.`)) {
      return;
    }
    setRegeneratingId(empId);
    try {
      const { login_code } = await regenerateLoginCode(empId);
      setEmployees((prev) => prev.map((e) => (e.emp_id === empId ? { ...e, login_code } : e)));
      setRevealedIds((prev) => new Set(prev).add(empId));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not regenerate login code.');
    } finally {
      setRegeneratingId(null);
    }
  }

  async function handleResetFace(empId: string) {
    if (!window.confirm(`Reset ${empId}'s Face ID? They will need to register their face again before Face ID can be used.`)) {
      return;
    }
    setResettingFaceId(empId);
    try {
      await resetFaceId(empId);
      setEmployees((prev) => prev.map((e) => (e.emp_id === empId ? { ...e, has_face_registered: false } : e)));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not reset Face ID.');
    } finally {
      setResettingFaceId(null);
    }
  }

  useEffect(() => {
    async function load() {
      const [emp, tsk] = await Promise.all([fetchEmployees(), fetchTasks()]);
      setEmployees(emp);
      setTasks(tsk);
      setLoading(false);
    }
    load();
  }, []);

  // Grouped by employee for the selected date only — recomputed from the
  // already-loaded full task list, same "filter client-side from one fetch"
  // approach TasksPage already uses, rather than a new date-scoped endpoint.
  const countsByEmpId = useMemo(() => {
    const map = new Map<string, TaskCounts>();
    for (const t of tasks) {
      if (t.task_date !== taskDate) continue;
      const counts = map.get(t.emp_id) ?? { ...EMPTY_COUNTS };
      counts.total += 1;
      const status = punchStatus(t);
      if (status === 'completed') counts.completed += 1;
      else if (status === 'pending') counts.pending += 1;
      else counts.notStarted += 1;
      map.set(t.emp_id, counts);
    }
    return map;
  }, [tasks, taskDate]);

  const tasksForModal = useMemo(() => {
    if (!tasksEmployee) return [];
    return tasks.filter((t) => t.emp_id === tasksEmployee.emp_id && t.task_date === taskDate);
  }, [tasks, tasksEmployee, taskDate]);

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
    [employees],
  );

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (deptFilter !== 'all' && e.department !== deptFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          e.emp_id.toLowerCase().includes(q) ||
          (e.designation ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, deptFilter, statusFilter, search]);

  if (loading) {
    return (
      <>
        <PageHeader title="Employees" subtitle="Manage your workforce" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Employees" subtitle={`${employees.length} total · ${filtered.length} shown`} />

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ID, role…"
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <Select value={deptFilter} onChange={setDeptFilter} label="" id="dept-filter">
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter} label="" id="status-filter">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <div className="w-44">
            <label htmlFor="employees-task-date" className="text-sm font-medium text-slate-700">Tasks for date</label>
            <input
              id="employees-task-date"
              type="date"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
                view === 'list' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <List className="h-4 w-4" /> List
            </button>
            <button
              type="button"
              onClick={() => setView('bar')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
                view === 'bar' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <LayoutGrid className="h-4 w-4" /> Bar view
            </button>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={<Users className="h-6 w-6" />} title="No employees found" message="Try adjusting your search or filters." />
        </Card>
      ) : view === 'bar' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => {
            const counts = countsByEmpId.get(e.emp_id) ?? EMPTY_COUNTS;
            return (
              <Card
                key={e.emp_id}
                className="cursor-pointer p-4 transition hover:shadow-md"
                onClick={() => setTasksEmployee(e)}
              >
                <div
                  className="flex items-center gap-3"
                  onClick={(ev) => { ev.stopPropagation(); setEditingEmployee(e); }}
                  title="View employee details"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
                    {initials(e.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 hover:text-teal-700 hover:underline">{e.name}</p>
                    <p className="truncate text-xs text-slate-500">{e.designation ?? e.emp_id}</p>
                  </div>
                </div>

                <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  {counts.total === 0 ? (
                    <div className="h-full w-full bg-slate-200" />
                  ) : (
                    <>
                      <div className="h-full bg-emerald-500" style={{ width: `${(counts.completed / counts.total) * 100}%` }} />
                      <div className="h-full bg-amber-400" style={{ width: `${(counts.pending / counts.total) * 100}%` }} />
                      <div className="h-full bg-slate-300" style={{ width: `${(counts.notStarted / counts.total) * 100}%` }} />
                    </>
                  )}
                </div>

                <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{counts.total} total</span>
                  <span className="flex items-center gap-2.5">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{counts.completed}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{counts.pending}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300" />{counts.notStarted}</span>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Department</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Designation</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Company</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Reports To</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Tasks</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Login Code</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Face ID</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => (
                  <tr key={e.emp_id} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div
                        className="flex cursor-pointer items-center gap-3"
                        onClick={() => setEditingEmployee(e)}
                        title="View employee details"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
                          {initials(e.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 hover:text-teal-700 hover:underline">{e.name}</p>
                          <p className="text-xs text-slate-500">{e.emp_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                        <Building2 className="h-3.5 w-3.5 text-slate-400" />{e.department ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                        <Briefcase className="h-3.5 w-3.5 text-slate-400" />{e.designation ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4"><span className="text-sm text-slate-600">{e.company ?? '—'}</span></td>
                    <td className="px-6 py-4"><span className="text-sm text-slate-600">{e.reporting_manager_emp_id ?? '—'}</span></td>
                    <td className="px-6 py-4">
                      {(() => {
                        const counts = countsByEmpId.get(e.emp_id) ?? EMPTY_COUNTS;
                        return (
                          <button
                            type="button"
                            onClick={() => setTasksEmployee(e)}
                            className="text-left text-sm text-slate-700 hover:text-teal-700 hover:underline"
                            title="View this employee's tasks for the selected date"
                          >
                            <span className="font-medium">{counts.total}</span> total
                            <span className="text-slate-400"> · </span>
                            <span className="text-amber-600">{counts.pending} pending</span>
                            <span className="text-slate-400"> · </span>
                            <span className="text-emerald-600">{counts.completed} done</span>
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={e.status === 'active' ? 'success' : 'neutral'}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm tracking-widest text-slate-700">
                          {e.login_code ? (revealedIds.has(e.emp_id) ? e.login_code : '•••••') : '—'}
                        </span>
                        {e.login_code && (
                          <button
                            type="button"
                            onClick={() => toggleRevealed(e.emp_id)}
                            className="text-slate-400 hover:text-slate-600"
                            title={revealedIds.has(e.emp_id) ? 'Hide code' : 'Show code'}
                          >
                            {revealedIds.has(e.emp_id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRegenerate(e.emp_id)}
                          disabled={regeneratingId === e.emp_id}
                          className="!px-2 !py-1"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${regeneratingId === e.emp_id ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {e.has_face_registered ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="success">Registered</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResetFace(e.emp_id)}
                            disabled={resettingFaceId === e.emp_id}
                            className="!px-2 !py-1"
                          >
                            <ScanFace className={`h-3.5 w-3.5 ${resettingFaceId === e.emp_id ? 'animate-pulse' : ''}`} />
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="neutral">Not registered</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingEmployee(e)}
                        className="!px-2 !py-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <EditEmployeeModal
        open={editingEmployee !== null}
        onClose={() => setEditingEmployee(null)}
        employee={editingEmployee}
        onSuccess={(updated) => {
          setEmployees((prev) => prev.map((emp) => (emp.emp_id === editingEmployee?.emp_id ? updated : emp)));
        }}
      />

      <EmployeeTasksModal
        employee={tasksEmployee}
        date={taskDate}
        tasks={tasksForModal}
        onClose={() => setTasksEmployee(null)}
      />
    </>
  );
}
