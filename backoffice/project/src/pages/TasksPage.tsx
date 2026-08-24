import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ClipboardList, Plus, CheckCircle2, XCircle, Loader2, MapPin, Calendar, Download, Upload, Filter, X, Pencil, Trash2 } from 'lucide-react';
import { fetchTasks, fetchEmployees, fetchProjects, createTask, deleteTask, tasksExportUrl, authHeaders, ApiError } from '@/lib/api';
import type { Task, Employee, Project } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Badge, Button, Select, Textarea, Input, Spinner, EmptyState, Modal } from '@/components/ui';
import { BulkUploadTasksModal } from '@/components/BulkUploadTasksModal';
import { EditTaskModal } from '@/components/EditTaskModal';
import { formatDate, initials, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  empId: string;
  projectCode: string;
  priority: string;
  description: string;
  locationSite: string;
};

const EMPTY_FORM: FormState = {
  empId: '',
  projectCode: '',
  priority: 'medium',
  description: '',
  locationSite: '',
};

// Derived from each task's own punch_count (via task_id), not the tasks.status
// DB column (which never actually transitions off 'pending' anywhere in this
// system, so it isn't a useful filter on its own): zero punches means the
// employee hasn't started it, an odd count means it's currently open
// (in progress), an even non-zero count means every session against it has
// been opened and closed.
type PunchStatus = 'not_started' | 'pending' | 'completed';

function punchStatus(task: Task): PunchStatus {
  if (task.punch_count === 0) return 'not_started';
  return task.punch_count % 2 === 0 ? 'completed' : 'pending';
}

const TABS: { key: PunchStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'pending', label: 'Pending' },
  { key: 'not_started', label: 'Not Started' },
];

export function TasksPage() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<PunchStatus | 'all'>('all');
  const [exportDate, setExportDate] = useState(todayDate());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [dateFilter, setDateFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

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

  // Deliberately doesn't go through load() / setLoading(true) — that swaps
  // the whole page out for a bare Spinner while it's true (see the early
  // return below), which would unmount BulkUploadTasksModal mid-result and
  // wipe the just-created/rejected-row summary the admin still needs to
  // read. Just re-fetches the list in place.
  async function refreshTasks() {
    setTasks(await fetchTasks());
  }

  async function handleConfirmDelete() {
    if (!deletingTask) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTask(deletingTask.id);
      setTasks((prev) => prev.filter((t) => t.id !== deletingTask.id));
      setDeletingTask(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete the task. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    if (!form.empId || !form.projectCode || !form.description.trim()) {
      setSubmitError('Employee, project, and description are required.');
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

  const employeeDeptMap = useMemo(() => new Map(employees.map((e) => [e.emp_id, e.department])), [employees]);
  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
    [employees],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<PunchStatus | 'all', number> = { all: tasks.length, completed: 0, pending: 0, not_started: 0 };
    for (const t of tasks) counts[punchStatus(t)] += 1;
    return counts;
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (activeTab !== 'all' && punchStatus(t) !== activeTab) return false;
      if (projectFilter !== 'all' && t.project_code !== projectFilter) return false;
      if (employeeFilter !== 'all' && t.emp_id !== employeeFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (departmentFilter !== 'all') {
        const empDept = employeeDeptMap.get(t.emp_id);
        if (empDept !== departmentFilter) return false;
      }
      if (dateFilter && t.task_date !== dateFilter) return false;
      return true;
    });
  }, [tasks, activeTab, projectFilter, employeeFilter, priorityFilter, departmentFilter, dateFilter, employeeDeptMap]);

  const hasFilters = dateFilter || projectFilter !== 'all' || departmentFilter !== 'all' || employeeFilter !== 'all' || priorityFilter !== 'all';

  function clearFilters() {
    setDateFilter('');
    setProjectFilter('all');
    setDepartmentFilter('all');
    setEmployeeFilter('all');
    setPriorityFilter('all');
  }

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

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Created By</span>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  {session?.name ?? session?.empId}
                </div>
              </div>

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

          <Card className="mt-6 p-6">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <Upload className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">Bulk Upload Tasks</h2>
            </div>
            <p className="mb-4 text-sm text-slate-500">
              Create many tasks at once from a filled-in Excel template — useful for scheduling work across
              several employees or days in one go.
            </p>
            <Button variant="secondary" onClick={() => setShowBulkUpload(true)} className="w-full">
              <Upload className="h-4 w-4" /> Upload Tasks
            </Button>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">All Tasks</h2>
            <Badge variant="neutral">{filtered.length}</Badge>
          </div>

          <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-sm font-medium transition',
                  activeTab === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {tab.label} <span className="text-xs text-slate-400">({tabCounts[tab.key]})</span>
              </button>
            ))}
          </div>

          <Card className="mb-4 p-4">
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
                <label htmlFor="task-date-filter" className="text-sm font-medium text-slate-700">Date</label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="task-date-filter"
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>
              <Select value={projectFilter} onChange={setProjectFilter} label="Project" id="task-project-filter">
                <option value="all">All projects</option>
                {projects.map((p) => (<option key={p.project_code} value={p.project_code}>{p.project_name ?? p.project_code}</option>))}
              </Select>
              <Select value={departmentFilter} onChange={setDepartmentFilter} label="Department" id="task-dept-filter">
                <option value="all">All departments</option>
                {departments.map((d) => (<option key={d} value={d}>{d}</option>))}
              </Select>
              <Select value={employeeFilter} onChange={setEmployeeFilter} label="Employee" id="task-emp-filter">
                <option value="all">All employees</option>
                {employees.map((e) => (<option key={e.emp_id} value={e.emp_id}>{e.name}</option>))}
              </Select>
              <Select value={priorityFilter} onChange={setPriorityFilter} label="Priority" id="task-priority-filter">
                <option value="all">All priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
          </Card>

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
              <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No tasks found" message="Try adjusting the filters above, or create a task using the form on the left." />
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((t) => {
                const priorityVariant = t.priority === 'high' ? 'error' : t.priority === 'medium' ? 'warning' : 'neutral';
                const status = punchStatus(t);
                const statusVariant = status === 'completed' ? 'success' : status === 'pending' ? 'warning' : 'neutral';
                const statusLabel = status === 'completed' ? 'Completed' : status === 'pending' ? 'Pending' : 'Not Started';
                return (
                  <Card key={t.id} className="p-5 transition hover:shadow-md">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {t.employee_name ? initials(t.employee_name) : '—'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-400">{t.display_id}</span>
                        </div>
                        <p className="text-sm font-medium text-slate-900">{t.description}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant={priorityVariant}>{t.priority ?? 'none'}</Badge>
                          <Badge variant={statusVariant}>{statusLabel}</Badge>
                          <span className="text-xs text-slate-500">{t.employee_name ?? 'Unassigned'}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500">{t.project_name ?? 'No project'}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          {t.location_site && (<span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {t.location_site}</span>)}
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDate(t.task_date)}</span>
                          <span>Created by {t.created_by}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingTask(t)} className="!px-2 !py-1">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setDeleteError(null); setDeletingTask(t); }} className="!px-2 !py-1 text-rose-600 hover:bg-rose-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <BulkUploadTasksModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onSuccess={refreshTasks}
      />

      <EditTaskModal
        open={editingTask !== null}
        onClose={() => setEditingTask(null)}
        task={editingTask}
        projects={projects}
        // Refetches rather than merging the PUT response in place — that
        // response doesn't carry the joined employee_name/project_name (only
        // GET / does), so a merge would leave a stale project_name showing
        // if the admin just changed the project.
        onSuccess={refreshTasks}
      />

      <Modal open={deletingTask !== null} onClose={() => setDeletingTask(null)} title="Delete this task?">
        <p className="mb-4 text-sm text-slate-600">
          {deletingTask && (
            <>This permanently removes <span className="font-medium text-slate-900">{deletingTask.display_id}</span>
              {' '}(&ldquo;{deletingTask.description}&rdquo;) for {deletingTask.employee_name ?? deletingTask.emp_id}.
              {' '}Blocked if any punch already references this task. This cannot be undone.</>
          )}
        </p>

        {deleteError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />{deleteError}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setDeletingTask(null)} disabled={deleting} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="flex-1 bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
          >
            {deleting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>) : (<><Trash2 className="h-4 w-4" /> Delete Task</>)}
          </Button>
        </div>
      </Modal>
    </>
  );
}
