import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Briefcase, Building2 } from 'lucide-react';
import { fetchEmployees } from '@/lib/api';
import type { Employee } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState, Select } from '@/components/ui';
import { initials } from '@/lib/utils';

export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    async function load() {
      const emp = await fetchEmployees();
      setEmployees(emp);
      setLoading(false);
    }
    load();
  }, []);

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
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={<Users className="h-6 w-6" />} title="No employees found" message="Try adjusting your search or filters." />
        </Card>
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
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => (
                  <tr key={e.emp_id} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
                          {initials(e.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{e.name}</p>
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
                      <Badge variant={e.status === 'active' ? 'success' : 'neutral'}>
                        {e.status}
                      </Badge>
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
