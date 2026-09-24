import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { todayRange, isDefaultRange, inRange, dateKeyInRiyadh, type DateRange } from '@/lib/dateRange';
import { Clock, Timer, CheckCircle2, XCircle, Loader2, Inbox, Calendar, Filter, X, Pencil } from 'lucide-react';
import {
  fetchAllPendingPunches,
  approvePunchAdmin,
  rejectPunchAdmin,
  fetchAllPendingOtApprovals,
  approveOtApprovalAdmin,
  rejectOtApprovalAdmin,
  fetchProjects,
  fetchEmployees,
  fetchPunchById,
  ApiError,
} from '@/lib/api';
import type { PendingPunch, OtApproval, Project, Employee, Punch } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Button, Badge, EmptyState, Spinner, Modal, Textarea, Select } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { AddPunchModal } from '@/components/AddPunchModal';
import { formatDateTime, formatDate, formatDurationHM } from '@/lib/utils';

// Item 3 — company-wide approval, straight from the backoffice, using the
// exact same endpoints the mobile supervisor Review Attendance tab already
// calls (see fetchAllPendingPunches/approvePunchAdmin/etc. in lib/api.ts) —
// the backend resolves this session's own Bearer token into a company-wide
// scope and a bypass of the "must be this employee's reporting manager"
// check that mobile's flow is still held to.
type RejectTarget = { kind: 'punch' | 'ot'; id: number; label: string } | null;

export function ApprovalsPage() {
  const [loading, setLoading] = useState(true);
  const [punches, setPunches] = useState<PendingPunch[]>([]);
  const [otApprovals, setOtApprovals] = useState<OtApproval[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Extra OT hours typed per pending punch, keyed by punch id — only ever
  // read for a closing (OUT) punch's own Approve click (see
  // handleApprovePunch below); an opening punch's entry, if any, is just
  // never sent.
  const [extraOtHoursByPunchId, setExtraOtHoursByPunchId] = useState<Record<number, string>>({});

  // Edit Punch (2026-09-23) — the same task-master project-edit flow the
  // Punches page's Edit Punch already has, reusing AddPunchModal exactly as
  // that page does. PendingPunch doesn't carry every field the modal needs,
  // so opening it fetches the full Punch row for that one id first.
  const [editingPunch, setEditingPunch] = useState<Punch | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);

  // Filters — matching the Punches page's filter bar for consistency. Project
  // only applies to the Pending Punches list (OT approvals aren't
  // project-scoped); Date filters punch_time for punches and work_date for OT.
  const [dateRange, setDateRange] = useState<DateRange>(todayRange);
  const [projectFilter, setProjectFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, o, prj, emp] = await Promise.all([
        fetchAllPendingPunches(),
        fetchAllPendingOtApprovals(),
        fetchProjects(),
        fetchEmployees(),
      ]);
      setPunches(p);
      setOtApprovals(o);
      setProjects(prj);
      setEmployees(emp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pending approvals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const employeeDeptMap = useMemo(() => new Map(employees.map((e) => [e.emp_id, e.department])), [employees]);
  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
    [employees],
  );

  const filteredPunches = useMemo(() => {
    return punches.filter((p) => {
      if (projectFilter !== 'all' && p.project_code !== projectFilter) return false;
      if (employeeFilter !== 'all' && p.emp_id !== employeeFilter) return false;
      if (departmentFilter !== 'all' && employeeDeptMap.get(p.emp_id) !== departmentFilter) return false;
      if (!inRange(dateKeyInRiyadh(p.punch_time), dateRange)) return false;
      return true;
    });
  }, [punches, projectFilter, employeeFilter, departmentFilter, dateRange, employeeDeptMap]);

  const filteredOtApprovals = useMemo(() => {
    return otApprovals.filter((o) => {
      if (employeeFilter !== 'all' && o.emp_id !== employeeFilter) return false;
      if (departmentFilter !== 'all' && employeeDeptMap.get(o.emp_id) !== departmentFilter) return false;
      if (!inRange(o.work_date.slice(0, 10), dateRange)) return false;
      return true;
    });
  }, [otApprovals, employeeFilter, departmentFilter, dateRange, employeeDeptMap]);

  const hasFilters = !isDefaultRange(dateRange) || projectFilter !== 'all' || departmentFilter !== 'all' || employeeFilter !== 'all';

  function clearFilters() {
    setDateRange(todayRange());
    setProjectFilter('all');
    setDepartmentFilter('all');
    setEmployeeFilter('all');
  }

  async function handleApprovePunch(id: number) {
    setProcessingId(`punch:${id}`);
    setError(null);
    try {
      const hoursRaw = extraOtHoursByPunchId[id];
      const extraOtMinutes = hoursRaw ? Math.round(Number(hoursRaw) * 60) : undefined;
      if (hoursRaw && (!Number.isFinite(extraOtMinutes) || extraOtMinutes! <= 0)) {
        setError('Extra OT must be a positive number of hours.');
        setProcessingId(null);
        return;
      }
      await approvePunchAdmin(id, extraOtMinutes);
      setPunches((prev) => prev.filter((p) => p.id !== id));
      setExtraOtHoursByPunchId((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the punch. Please try again.');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleApproveOt(id: number) {
    setProcessingId(`ot:${id}`);
    setError(null);
    try {
      await approveOtApprovalAdmin(id);
      setOtApprovals((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the OT request. Please try again.');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleOpenEdit(id: number) {
    setLoadingEditId(id);
    setError(null);
    try {
      setEditingPunch(await fetchPunchById(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this punch for editing. Please try again.');
    } finally {
      setLoadingEditId(null);
    }
  }

  function openReject(kind: 'punch' | 'ot', id: number, label: string) {
    setRejectTarget({ kind, id, label });
    setRejectReason('');
    setRejectError(null);
  }

  async function handleConfirmReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setRejectError('A reason is required.');
      return;
    }
    setRejecting(true);
    setRejectError(null);
    try {
      if (rejectTarget.kind === 'punch') {
        await rejectPunchAdmin(rejectTarget.id, rejectReason.trim());
        setPunches((prev) => prev.filter((p) => p.id !== rejectTarget.id));
      } else {
        await rejectOtApprovalAdmin(rejectTarget.id, rejectReason.trim());
        setOtApprovals((prev) => prev.filter((o) => o.id !== rejectTarget.id));
      }
      setRejectTarget(null);
    } catch (err) {
      setRejectError(err instanceof ApiError ? err.message : 'Could not reject. Please try again.');
    } finally {
      setRejecting(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Approvals" subtitle="Punches and overtime awaiting review, company-wide." />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-[640px] flex-col">
      <div className="shrink-0">
      <PageHeader title="Approvals" subtitle="Punches and overtime awaiting review, company-wide." />
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {/* Sticky (2026-09-24): filters scroll away; each section heading (with its count) pins to the top while its rows scroll beneath. */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateRangeFilter id="approvals-date-filter" value={dateRange} onChange={setDateRange} />
          <SearchableSelect
            value={projectFilter}
            onChange={setProjectFilter}
            label="Project"
            id="approvals-project-filter"
            placeholder="All projects"
            searchPlaceholder="Search by code or name…"
            emptyMessage="No projects match."
            options={[
              { value: 'all', label: 'All projects' },
              ...projects.map((p) => ({ value: p.project_code, label: p.project_code, sublabel: p.project_name })),
            ]}
          />
          <Select value={departmentFilter} onChange={setDepartmentFilter} label="Department" id="approvals-dept-filter">
            <option value="all">All departments</option>
            {departments.map((d) => (<option key={d} value={d}>{d}</option>))}
          </Select>
          <SearchableSelect
            value={employeeFilter}
            onChange={setEmployeeFilter}
            label="Employee"
            id="approvals-emp-filter"
            placeholder="All employees"
            searchPlaceholder="Search by name or ID…"
            emptyMessage="No employees match."
            options={[
              { value: 'all', label: 'All employees' },
              ...employees.map((e) => ({ value: e.emp_id, label: e.name, sublabel: e.emp_id })),
            ]}
          />
        </div>
      </Card>

      <div className="space-y-8">
        <div>
          <div className="sticky top-0 z-10 mb-4 flex items-center gap-2 bg-slate-50 py-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Pending Punches</h2>
            <Badge variant="neutral">{filteredPunches.length}</Badge>
          </div>

          {filteredPunches.length === 0 ? (
            <Card className="p-6">
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title="Nothing pending"
                message={hasFilters ? 'No pending punches match your filters.' : 'Every punch has been reviewed.'}
              />
            </Card>
          ) : (
            <Card className="divide-y divide-slate-100">
              {filteredPunches.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.employee_name ?? p.emp_id}</p>
                    <p className="text-xs text-slate-500">
                      {p.task_display_id ? `${p.task_display_id} — ` : ''}{p.project_name ?? p.project_code ?? 'No project'} · {formatDateTime(p.punch_time)}
                    </p>
                    <p className="text-xs text-slate-400">Entered by {p.entered_by} ({p.entry_method})</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.is_in_punch === false && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="Extra OT"
                          value={extraOtHoursByPunchId[p.id] ?? ''}
                          onChange={(e) => setExtraOtHoursByPunchId((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          className="w-24 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                        />
                        <span className="text-xs text-slate-400">hrs</span>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleOpenEdit(p.id)}
                      disabled={loadingEditId === p.id}
                    >
                      {loadingEditId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApprovePunch(p.id)}
                      disabled={processingId === `punch:${p.id}`}
                      className="!bg-emerald-600 hover:!bg-emerald-700"
                    >
                      {processingId === `punch:${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openReject('punch', p.id, `${p.employee_name ?? p.emp_id}'s punch`)}
                      disabled={processingId === `punch:${p.id}`}
                      className="!text-rose-600"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div>
          <div className="sticky top-0 z-10 mb-4 flex items-center gap-2 bg-slate-50 py-2">
            <Timer className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Pending Overtime</h2>
            <Badge variant="neutral">{filteredOtApprovals.length}</Badge>
          </div>

          {filteredOtApprovals.length === 0 ? (
            <Card className="p-6">
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title="Nothing pending"
                message={hasFilters ? 'No pending overtime requests match your filters.' : 'Every overtime request has been reviewed.'}
              />
            </Card>
          ) : (
            <Card className="divide-y divide-slate-100">
              {filteredOtApprovals.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{o.employee_name}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(o.work_date)} · worked {formatDurationHM(o.worked_minutes)}, threshold {formatDurationHM(o.threshold_minutes)} — {formatDurationHM(o.ot_minutes)} OT
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApproveOt(o.id)}
                      disabled={processingId === `ot:${o.id}`}
                      className="!bg-emerald-600 hover:!bg-emerald-700"
                    >
                      {processingId === `ot:${o.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openReject('ot', o.id, `${o.employee_name}'s overtime request`)}
                      disabled={processingId === `ot:${o.id}`}
                      className="!text-rose-600"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
      </div>

      <AddPunchModal
        open={editingPunch !== null}
        onClose={() => setEditingPunch(null)}
        employees={employees}
        projects={projects}
        editingPunch={editingPunch}
        onSuccess={() => {
          setEditingPunch(null);
          load();
        }}
      />

      <Modal open={rejectTarget !== null} onClose={() => setRejectTarget(null)} title="Reject">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Rejecting {rejectTarget?.label}. A reason is required.</p>
          <Textarea value={rejectReason} onChange={setRejectReason} label="Reason" id="reject-reason" placeholder="Why is this being rejected?" />
          {rejectError && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              <XCircle className="h-4 w-4 shrink-0" />{rejectError}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={() => setRejectTarget(null)} disabled={rejecting} className="flex-1">
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmReject} disabled={rejecting} className="flex-1 !bg-rose-600 hover:!bg-rose-700">
              {rejecting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Rejecting…</>) : 'Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
