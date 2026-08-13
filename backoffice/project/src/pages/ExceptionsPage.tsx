import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Filter,
  X,
  User,
  Calendar,
  Plus,
} from 'lucide-react';
import { fetchExceptions, resolveException, fetchEmployees, fetchProjects } from '@/lib/api';
import type { ExceptionRow, Employee, Project } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Button, Select, Spinner, EmptyState } from '@/components/ui';
import { AddPunchModal } from '@/components/AddPunchModal';
import { cn, formatDateTime, initials } from '@/lib/utils';

const TYPE_VARIANTS: Record<string, 'error' | 'warning' | 'info' | 'accent' | 'neutral'> = {
  single_punch_only: 'error',
  artify_sync_failure: 'warning',
};

const TYPE_LABELS: Record<string, string> = {
  single_punch_only: 'Single Punch Only',
  artify_sync_failure: 'ARTIFY Sync Failure',
};

function typeBadgeVariant(type: string): 'error' | 'warning' | 'info' | 'accent' | 'neutral' {
  return TYPE_VARIANTS[type] ?? 'neutral';
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

export function ExceptionsPage() {
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [addPunchFor, setAddPunchFor] = useState<ExceptionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, emp, prj] = await Promise.all([fetchExceptions(), fetchEmployees(), fetchProjects()]);
      setExceptions(data);
      setEmployees(emp);
      setProjects(prj);
    } catch {
      setError('Could not load exceptions. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Adding the punch and resolving the exception it was raised for are one
  // action from the admin's point of view — chained here client-side rather
  // than coupling the two on the backend.
  async function handlePunchAdded() {
    const exception = addPunchFor;
    setAddPunchFor(null);
    if (!exception) return;
    try {
      const updated = await resolveException(exception.id);
      setExceptions((prev) => prev.map((e) => (e.id === exception.id ? updated : e)));
    } catch {
      setError('Punch was added, but the exception could not be auto-resolved. Resolve it manually below.');
    }
  }

  async function handleResolve(id: number) {
    setResolvingId(id);
    try {
      const updated = await resolveException(id);
      setExceptions((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch {
      setError('Could not resolve this exception. Please try again.');
    } finally {
      setResolvingId(null);
    }
  }

  const availableTypes = useMemo(() => {
    const types = new Set(exceptions.map((e) => e.type));
    return Array.from(types).sort();
  }, [exceptions]);

  const filtered = useMemo(() => {
    return exceptions.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      return true;
    });
  }, [exceptions, typeFilter, statusFilter]);

  const openCount = exceptions.filter((e) => e.status === 'open').length;
  const resolvedCount = exceptions.filter((e) => e.status === 'resolved').length;
  const hasFilters = typeFilter !== 'all' || statusFilter !== 'all';

  function clearFilters() {
    setTypeFilter('all');
    setStatusFilter('all');
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Exceptions" subtitle="Review and resolve attendance exceptions" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Exceptions" subtitle="Review and resolve attendance exceptions" />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-rose-500 hover:text-rose-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Exceptions</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{exceptions.length}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Open</p>
              <p className="mt-1 text-2xl font-bold text-amber-600">{openCount}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Resolved</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{resolvedCount}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select value={typeFilter} onChange={setTypeFilter} label="Type" id="exc-type-filter">
            <option value="all">All types</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>{typeLabel(t)}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter} label="Status" id="exc-status-filter">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </Select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="No exceptions found"
            message={hasFilters ? 'Try adjusting or clearing the filters above.' : 'No exceptions have been recorded yet.'}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => {
            const isOpen = e.status === 'open';
            return (
              <Card key={e.id} className={cn('p-5 transition hover:shadow-md', isOpen && 'ring-1 ring-amber-200/50')}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      isOpen ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700',
                    )}>
                      {e.employee_name ? initials(e.employee_name) : <AlertTriangle className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={typeBadgeVariant(e.type)}>{typeLabel(e.type)}</Badge>
                        <Badge variant={isOpen ? 'warning' : 'success'}>{e.status}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{e.details}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                        {e.employee_name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {e.employee_name}
                            {e.employee_designation && ` · ${e.employee_designation}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {formatDateTime(e.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="flex shrink-0 gap-2">
                      {e.type === 'single_punch_only' && e.emp_id && (
                        <Button size="sm" variant="secondary" onClick={() => setAddPunchFor(e)}>
                          <Plus className="h-4 w-4" /> Add Punch
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleResolve(e.id)}
                        disabled={resolvingId === e.id}
                      >
                        {resolvingId === e.id ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Resolving…</>
                        ) : (
                          <><CheckCircle2 className="h-4 w-4" /> Resolve</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AddPunchModal
        open={addPunchFor !== null}
        onClose={() => setAddPunchFor(null)}
        employees={employees}
        projects={projects}
        defaultEmpId={addPunchFor?.emp_id ?? undefined}
        defaultProjectCode={addPunchFor?.ref_project_code ?? undefined}
        defaultDate={addPunchFor?.ref_punch_time ? addPunchFor.ref_punch_time.slice(0, 10) : undefined}
        lockEmployee
        onSuccess={handlePunchAdded}
      />
    </>
  );
}
