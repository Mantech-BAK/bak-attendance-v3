import { useEffect, useMemo, useState } from 'react';
import { CalendarOff, Calendar, Filter, X, Image as ImageIcon } from 'lucide-react';
import { fetchLeaveReports } from '@/lib/api';
import type { LeaveReport } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState, Select, FIELD_LABEL } from '@/components/ui';
import { formatDate, formatDateTime, initials } from '@/lib/utils';

const LEAVE_TYPES = ['Sick Leave', 'Annual Leave', 'Emergency Leave', 'Unpaid Leave', 'Compassionate Leave'];

const LEAVE_TYPE_VARIANT: Record<string, 'error' | 'warning' | 'info' | 'accent' | 'neutral'> = {
  'Sick Leave': 'warning',
  'Annual Leave': 'info',
  'Emergency Leave': 'error',
  'Unpaid Leave': 'neutral',
  'Compassionate Leave': 'accent',
};

export function ReportedLeavesPage() {
  const [leaves, setLeaves] = useState<LeaveReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    fetchLeaveReports()
      .then(setLeaves)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return leaves.filter((l) => {
      if (typeFilter !== 'all' && l.leave_type !== typeFilter) return false;
      if (dateFilter && l.leave_date.slice(0, 10) !== dateFilter) return false;
      return true;
    });
  }, [leaves, dateFilter, typeFilter]);

  const hasFilters = dateFilter || typeFilter !== 'all';

  if (loading) {
    return (
      <>
        <PageHeader title="Reported Leaves" subtitle="Leave reports submitted from the mobile app" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Reported Leaves" subtitle="Leave reports submitted from the mobile app" />

      <Card className="mb-6 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Filters</span>
          {hasFilters && (
            <button
              onClick={() => { setDateFilter(''); setTypeFilter('all'); }}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-rose-600"
            >
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-date-filter" className={FIELD_LABEL}>Date</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="leave-date-filter"
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/15"
              />
            </div>
          </div>
          <Select value={typeFilter} onChange={setTypeFilter} label="Leave Type" id="leave-type-filter">
            <option value="all">All types</option>
            {LEAVE_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
          </Select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={<CalendarOff className="h-6 w-6" />} title="No reported leaves" message="Leave reports submitted from the mobile app will appear here." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Leave Date</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Remarks</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Photo</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Reported At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((l) => (
                  <tr key={l.id} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {l.employee_name ? initials(l.employee_name) : '—'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{l.employee_name ?? l.emp_id}</p>
                          <p className="text-xs text-slate-500">{l.employee_designation ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><p className="text-sm text-slate-700">{formatDate(l.leave_date)}</p></td>
                    <td className="px-6 py-4"><Badge variant={LEAVE_TYPE_VARIANT[l.leave_type] ?? 'neutral'}>{l.leave_type}</Badge></td>
                    <td className="px-6 py-4 max-w-xs">
                      {l.remarks ? (
                        <p className="text-sm text-slate-700">{l.remarks}</p>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {l.photo_url ? (
                        <a
                          href={l.photo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline"
                        >
                          <ImageIcon className="h-3.5 w-3.5" /> View / Download
                        </a>
                      ) : (
                        <span className="text-sm text-slate-400">No photo</span>
                      )}
                    </td>
                    <td className="px-6 py-4"><p className="text-sm text-slate-700">{formatDateTime(l.created_at)}</p></td>
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
