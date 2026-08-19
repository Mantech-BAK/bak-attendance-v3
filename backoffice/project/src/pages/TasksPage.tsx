import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ClipboardList, Plus, CheckCircle2, XCircle, Loader2, MapPin, Calendar, Download } from 'lucide-react';
import { fetchTasks, fetchEmployees, fetchProjects, createTask, tasksExportUrl, authHeaders } from '@/lib/api';
import type { Task, Employee, Project } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Button, Select, Textarea, Input, Spinner, EmptyState } from '@/components/ui';
import { formatDate, initials } from '@/lib/utils';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  empId: string;
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string;
  createdBy: string;
};

const EMPTY_FORM: FormState = {
  empId: '',
  projectCode: '',
  priority: 'medium',
  description: '',
  locationSite: '',
  createdBy: '',
};

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [exportDate, setExportDate] = useState(todayDate());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [tsk, emp, prj] = await Promise.all([fetchTasks(), fetchEmployees(), fetchProjects('OPEN')]);
    setTasks(tsk);
    setEmployees(emp);
    setProjects(prj);
    setLoading(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    if (!form.empId || !form.projectCode || !form.description.trim() || !form.createdBy) {
      setSubmitError('Employee, project, created by, and description are required.');
      return;
    }

    setSubmitting(true);
    try {
      await createTask({
        empId: form.empId,
        projectCode: form.projectCode,
        priority: form.priority,
        description: form.description.trim(),
        locationSite: form.locationSite.trim() || null,
        createdBy: form.createdBy,
      });
      setSubmitSuccess(true);
      setForm(EMPTY_FORM);
      await load();
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create the task. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const response = await fetch(tasksExportUrl(exportDate), { headers: authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tasks-${exportDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export tasks for this date.');
    } finally {
      setExporting(false);
    }
  }

  const availableStatuses = useMemo(() => {
    return Array.from(new Set(tasks.map((t) => t.status))).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return tasks;
    return tasks.filter((t) => t.status === statusFilter);
  }, [tasks, statusFilter]);

  if (loading) {
    return (
      <>
        <PageHeader title="Tasks" subtitle="Assign and track work across projects" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Tasks" subtitle="Assign and track work across projects" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card className="p-6 lg:sticky lg:top-6">
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <Plus className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">Create Task</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Select value={form.empId} onChange={(v) => setForm({ ...form, empId: v })} label="Employee" id="task-employee">
                <option value="">Select employee…</option>
                {employees.map((e) => (<option key={e.emp_id} value={e.emp_id}>{e.name}</option>))}
              </Select>

              <Select value={form.projectCode} onChange={(v) => setForm({ ...form, projectCode: v })} label="Project" id="task-project">
                <option value="">Select project…</option>
                {projects.map((p) => (<option key={p.project_code} value={p.project_code}>{p.project_name ?? p.project_code}</option>))}
              </Select>

              <Select value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} label="Priority" id="task-priority">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>

              <Textarea value={form.description} onChange={(v) => setForm({ ...form, description: v })} label="Description" id="task-description" placeholder="Describe the task in detail…" rows={4} />

              <Input value={form.locationSite} onChange={(v) => setForm({ ...form, locationSite: v })} label="Location" id="task-location" placeholder="e.g. Site office, Dock 2…" />

              <Select value={form.createdBy} onChange={(v) => setForm({ ...form, createdBy: v })} label="Created By" id="task-created-by">
                <option value="">Select admin…</option>
                {employees.map((e) => (<option key={e.emp_id} value={e.emp_id}>{e.name}</option>))}
              </Select>

              {submitError && (
                <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                  <XCircle className="h-4 w-4 shrink-0" />{submitError}
                </div>
              )}
              {submitSuccess && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />Task created successfully.
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>) : (<><Plus className="h-4 w-4" /> Create Task</>)}
              </Button>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-slate-400" />
              <h2 className="text-base font-semibold text-slate-900">All Tasks</h2>
              <Badge variant="neutral">{filtered.length}</Badge>
            </div>
            <div className="w-40">
              <Select value={statusFilter} onChange={setStatusFilter} label="" id="task-status-filter">
                <option value="all">All statuses</option>
                {availableStatuses.map((s) => (<option key={s} value={s}>{s}</option>))}
              </Select>
            </div>
          </div>

          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Input value={exportDate} onChange={setExportDate} label="Export by Date" id="task-export-date" type="date" />
              </div>
              <Button variant="secondary" onClick={handleExport} disabled={exporting || !exportDate}>
                {exporting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Exporting…</>) : (<><Download className="h-4 w-4" /> Export to Excel</>)}
              </Button>
            </div>
            {exportError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{exportError}
              </div>
            )}
          </Card>

          {filtered.length === 0 ? (
            <Card className="p-6">
              <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No tasks found" message="Create a task using the form on the left." />
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((t) => {
                const priorityVariant = t.priority === 'high' ? 'error' : t.priority === 'medium' ? 'warning' : 'neutral';
                return (
                  <Card key={t.id} className="p-5 transition hover:shadow-md">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {t.employee_name ? initials(t.employee_name) : '—'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{t.description}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant={priorityVariant}>{t.priority ?? 'none'}</Badge>
                          <Badge variant="info">{t.status}</Badge>
                          <span className="text-xs text-slate-500">{t.employee_name ?? 'Unassigned'}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500">{t.project_name ?? 'No project'}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          {t.location_site && (<span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {t.location_site}</span>)}
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDate(t.created_at)}</span>
                          <span>Created by {t.created_by}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
