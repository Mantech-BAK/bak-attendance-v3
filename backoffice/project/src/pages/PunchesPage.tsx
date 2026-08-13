import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Calendar, Filter, X, Plus } from 'lucide-react';
import { fetchPunches, fetchProjects, fetchEmployees } from '@/lib/api';
import type { Punch, Project, Employee } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState, Select, Button } from '@/components/ui';
import { AddPunchModal } from '@/components/AddPunchModal';
import { formatDateTime, initials } from '@/lib/utils';

export function PunchesPage() {
  const [punches, setPunches] = useState<Punch[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPunch, setShowAddPunch] = useState(false);

  const [dateFilter, setDateFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    const [pch, prj, emp] = await Promise.all([fetchPunches(), fetchProjects(), fetchEmployees()]);
    setPunches(pch);
    setProjects(prj);
    setEmployees(emp);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const employeeDeptMap = useMemo(() => new Map(employees.map((e) => [e.emp_id, e.department])), [employees]);
  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
    [employees],
  );

  const filtered = useMemo(() => {
    return punches.filter((p) => {
      if (projectFilter !== 'all' && p.project_code !== projectFilter) return false;
      if (employeeFilter !== 'all' && p.emp_id !== employeeFilter) return false;
      if (statusFilter !== 'all' && p.approval_status !== statusFilter) return false;
      if (departmentFilter !== 'all') {
        const empDept = employeeDeptMap.get(p.emp_id);
        if (empDept !== departmentFilter) return false;
      }
      if (dateFilter) {
        const punchDate = new Date(p.punch_time).toISOString().slice(0, 10);
        if (punchDate !== dateFilter) return false;
      }
      return true;
    });
  }, [punches, projectFilter, employeeFilter, departmentFilter, statusFilter, dateFilter, employeeDeptMap]);

  const hasFilters = dateFilter || projectFilter !== 'all' || departmentFilter !== 'all' || employeeFilter !== 'all' || statusFilter !== 'all';

  function clearFilters() {
    setDateFilter('');
    setProjectFilter('all');
    setDepartmentFilter('all');
    setEmployeeFilter('all');
    setStatusFilter('all');
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Punches" subtitle="Review time and attendance entries" />
        <Spinner />
      </>
    );
  }

  const pendingCount = filtered.filter((p) => p.approval_status === 'pending').length;
  const approvedCount = filtered.filter((p) => p.approval_status === 'approved').length;

  return (
    <>
      <PageHeader
        title="Punches"
        subtitle="Review time and attendance entries"
        action={
          <Button onClick={() => setShowAddPunch(true)}>
            <Plus className="h-4 w-4" /> Add Punch
          </Button>
        }
      />

      <AddPunchModal
        open={showAddPunch}
        onClose={() => setShowAddPunch(false)}
        employees={employees}
        projects={projects}
        onSuccess={() => load()}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Filtered Entries</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{filtered.length}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Pending Approval</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{pendingCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Approved</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{approvedCount}</p>
        </Card>
      </div>

      <Card className="mb-6 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Filters</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-rose-600">
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="date-filter" className="text-sm font-medium text-slate-700">Date</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="date-filter"
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
          </div>
          <Select value={projectFilter} onChange={setProjectFilter} label="Project" id="punch-project-filter">
            <option value="all">All projects</option>
            {projects.map((p) => (<option key={p.project_code} value={p.project_code}>{p.project_name ?? p.project_code}</option>))}
          </Select>
          <Select value={departmentFilter} onChange={setDepartmentFilter} label="Department" id="punch-dept-filter">
            <option value="all">All departments</option>
            {departments.map((d) => (<option key={d} value={d}>{d}</option>))}
          </Select>
          <Select value={employeeFilter} onChange={setEmployeeFilter} label="Employee" id="punch-emp-filter">
            <option value="all">All employees</option>
            {employees.map((e) => (<option key={e.emp_id} value={e.emp_id}>{e.name}</option>))}
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter} label="Status" id="punch-status-filter">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={<Clock className="h-6 w-6" />} title="No punches match your filters" message="Try adjusting or clearing the filters above." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Project</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Punch Time</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Entry Method</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {p.employee_name ? initials(p.employee_name) : '—'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{p.employee_name ?? 'Unknown'}</p>
                          <p className="text-xs text-slate-500">{p.employee_designation ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><span className="text-sm text-slate-700">{p.project_name ?? '—'}</span></td>
                    <td className="px-6 py-4"><p className="text-sm text-slate-700">{formatDateTime(p.punch_time)}</p></td>
                    <td className="px-6 py-4">
                      <Badge variant={p.entry_method === 'admin_correction' ? 'warning' : p.entry_method === 'supervisor' ? 'accent' : 'neutral'}>
                        {p.entry_method === 'admin_correction'
                          ? `Admin Correction (${p.entered_by})`
                          : p.entry_method === 'supervisor'
                            ? `Supervisor (${p.entered_by})`
                            : 'Self'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={p.approval_status === 'approved' ? 'success' : p.approval_status === 'rejected' ? 'error' : 'warning'}>
                        {p.approval_status}
                      </Badge>
                      {p.approval_status === 'rejected' && p.rejection_reason && (
                        <p className="mt-1 text-xs text-slate-400">{p.rejection_reason}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
