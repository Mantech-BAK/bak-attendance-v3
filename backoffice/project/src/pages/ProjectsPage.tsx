import { useEffect, useMemo, useState } from 'react';
import { Building2, Search, Tag } from 'lucide-react';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState, Select } from '@/components/ui';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    async function load() {
      const result = await fetchProjects();
      setProjects(result);
      setLoading(false);
    }
    load();
  }, []);

  const companies = useMemo(
    () => Array.from(new Set(projects.map((p) => p.company).filter(Boolean))) as string[],
    [projects],
  );

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (companyFilter !== 'all' && p.company !== companyFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          (p.project_name ?? '').toLowerCase().includes(q) ||
          p.project_code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [projects, companyFilter, statusFilter, search]);

  if (loading) {
    return (
      <>
        <PageHeader title="Projects" subtitle="All projects across the organization" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Projects" subtitle={`${projects.length} total · ${filtered.length} shown`} />

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or code…"
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <Select value={companyFilter} onChange={setCompanyFilter} label="" id="project-company-filter">
            <option value="all">All companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter} label="" id="project-status-filter">
            <option value="all">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={<Building2 className="h-6 w-6" />} title="No projects found" message="Try adjusting your search or filters." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Project</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Company</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Cost Center</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.project_code} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{p.project_name ?? p.project_code}</p>
                          <p className="text-xs text-slate-500">{p.project_code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><span className="text-sm text-slate-600">{p.company ?? '—'}</span></td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                        <Tag className="h-3.5 w-3.5 text-slate-400" />{p.cost_center ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={p.status === 'OPEN' ? 'success' : 'neutral'}>
                        {p.status}
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
