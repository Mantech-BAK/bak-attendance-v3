import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { addAdminPunchCorrection, updatePunch, fetchPunchableTasks, ApiError } from '@/lib/api';
import type { Employee, Punch, PunchableTask } from '@/lib/api';
import { Modal, Button, Select, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

// Converts the date/time input's local wall-clock values (as the admin's
// own browser understands "local") into a correct absolute-instant ISO
// string — building a Date from local components and letting toISOString()
// do the UTC conversion, rather than gluing the digits straight onto a "Z"
// suffix (which silently mislabels local time as UTC and shifts every
// saved punch by the browser's UTC offset).
function localDateTimeToIso(date: string, time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

// Pre-fills the form with "now" (admin's own local wall-clock) as a
// convenience default — they can still change either field freely before
// submitting. The backend itself never defaults to "now" on its own; it
// always receives whatever explicit date/time the form actually submits.
function nowDateAndTime(): { date: string; time: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function isoToLocalDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// A task's dropdown key — task.id when it's a real task, else a stable key
// for the single department-default fallback entry (id is null there).
function taskKey(task: Pick<PunchableTask, 'id' | 'project_code'>): string {
  return task.id !== null ? String(task.id) : `default:${task.project_code}`;
}

/**
 * Admin-only manual punch correction — sets an explicit timestamp (never
 * "now") and is auto-approved immediately, no review queue. Shared between
 * the Punches page ("Add Punch" and, via editingPunch, "Edit Punch"), and
 * the Exceptions page (contextual "Add Punch" on a single_punch_only card,
 * with employee/task/date pre-filled from the existing incomplete punch).
 *
 * The task picker (not a separate project picker) is the entire point of
 * per-task punch tracking: choosing a task auto-fills and locks its
 * project — there's no independently-editable project field anymore, only
 * a read-only line showing which project the chosen task belongs to.
 */
export function AddPunchModal({
  open,
  onClose,
  employees,
  defaultEmpId,
  defaultDate,
  defaultTaskId,
  defaultProjectCode,
  lockEmployee,
  editingPunch,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  defaultEmpId?: string;
  defaultDate?: string;
  // Pre-selects (and force-includes, even if not in the fetched punchable
  // list) a specific task/fallback-project — used by the Exceptions flow to
  // default to the same task an incomplete punch was already against,
  // without locking the field the way editingPunch does.
  defaultTaskId?: number | null;
  defaultProjectCode?: string | null;
  lockEmployee?: boolean;
  // When set, the modal edits this existing punch instead of creating a new
  // one — emp_id is always locked in this mode (a different employee is a
  // different punch, not a correction).
  editingPunch?: Punch | null;
  onSuccess: (punch: Punch) => void;
}) {
  const isEditing = !!editingPunch;
  const { session } = useAuth();
  const [empId, setEmpId] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null = not yet resolved for the current employee/date (either one is
  // still blank, or the fetch hasn't returned) — the task field stays
  // disabled until this is a real array, so there's never a moment where
  // an arbitrary task is selectable.
  const [punchableTasks, setPunchableTasks] = useState<PunchableTask[] | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (editingPunch) {
      const { date: d, time: t } = isoToLocalDateTime(editingPunch.punch_time);
      setEmpId(editingPunch.emp_id);
      setSelectedKey(editingPunch.task_id !== null ? String(editingPunch.task_id) : `default:${editingPunch.project_code}`);
      setDate(d);
      setTime(t);
    } else {
      // defaultDate (the Exceptions flow completing a specific existing
      // punch) always wins over "now" — that flow needs the date of the
      // incomplete session being corrected, not today.
      const { date: nowDate, time: nowTime } = nowDateAndTime();
      setEmpId(defaultEmpId ?? '');
      setSelectedKey(defaultTaskId ? String(defaultTaskId) : defaultProjectCode ? `default:${defaultProjectCode}` : '');
      setDate(defaultDate ?? nowDate);
      setTime(defaultDate ? '' : nowTime);
    }
    setError(null);
    setPunchableTasks(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultEmpId, defaultDate, defaultTaskId, defaultProjectCode, editingPunch]);

  // Restricts the Task field to only what this employee could legitimately
  // punch on this date: a real task they're assigned, or (absent any) their
  // department default — never an arbitrary task/project off a free
  // dropdown. When editing, the punch's own existing task/project is always
  // included too, even on the rare chance it isn't in that set, since it's
  // the specific real punch being corrected.
  useEffect(() => {
    if (!open || !empId || !date) {
      setPunchableTasks(null);
      return;
    }
    let cancelled = false;
    setLoadingTasks(true);
    fetchPunchableTasks(empId, date)
      .then((result) => {
        if (cancelled) return;
        let tasks = result.tasks;
        if (editingPunch && !tasks.some((t) => taskKey(t) === selectedKey)) {
          tasks = [
            ...tasks,
            {
              id: editingPunch.task_id,
              display_id: editingPunch.task_display_id,
              project_code: editingPunch.project_code ?? '',
              name: editingPunch.task_description || editingPunch.project_name || editingPunch.project_code || 'This punch',
              priority: null,
              status: 'existing',
              is_default: editingPunch.task_id === null,
            },
          ];
        } else if (!editingPunch && (defaultTaskId || defaultProjectCode) && !tasks.some((t) => taskKey(t) === selectedKey)) {
          tasks = [
            ...tasks,
            {
              id: defaultTaskId ?? null,
              display_id: null,
              project_code: defaultProjectCode ?? '',
              name: defaultProjectCode ?? 'This punch',
              priority: null,
              status: 'existing',
              is_default: !defaultTaskId,
            },
          ];
        }
        setPunchableTasks(tasks);
      })
      .catch(() => {
        if (!cancelled) setPunchableTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, empId, date]);

  // If the employee or date changes out from under a previously valid
  // selection, don't leave a now-invalid task silently selected.
  useEffect(() => {
    if (punchableTasks && selectedKey && !punchableTasks.some((t) => taskKey(t) === selectedKey)) {
      setSelectedKey('');
    }
  }, [punchableTasks, selectedKey]);

  const selectedTask = punchableTasks?.find((t) => taskKey(t) === selectedKey) ?? null;

  // Task, date, and time are all mandatory — a punch with any of them
  // missing is meaningless, so Submit stays disabled until the form is
  // genuinely complete rather than only validating after the fact.
  const isComplete = !!empId && !!selectedKey && !!date && !!time;

  async function submitPunch(punchTime: string, force: boolean) {
    const taskId = selectedTask?.id ?? null;
    const projectCode = taskId ? null : selectedTask?.project_code ?? null;

    if (isEditing) {
      return updatePunch(editingPunch!.id, { taskId, projectCode, punchTime, force });
    }
    return addAdminPunchCorrection({ empId, taskId, projectCode, punchTime, force });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Defense in depth — Submit is already disabled until isComplete, but
    // this still runs in case the button is somehow triggered anyway (e.g.
    // pressing Enter in a field before state has settled).
    if (!empId || !selectedKey || !date || !time) {
      setError('Employee, task, date, and time are all required.');
      return;
    }

    setSubmitting(true);
    try {
      const punchTime = localDateTimeToIso(date, time);
      let punch;
      try {
        punch = await submitPunch(punchTime, false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as {
            duplicate?: { punch_time: string };
            conflicting_punch?: unknown;
            open_project_code?: string;
          } | null;
          // A cross-task/project clash (identical timestamp) or an
          // already-open fallback project on that same day are both hard
          // blocks on the backend — force cannot bypass either, since
          // neither is a "might be intentional" case, just a broken
          // invariant. Surface as a plain error, not a confirm-and-retry
          // dialog.
          if (body?.conflicting_punch || body?.open_project_code) {
            throw err;
          }
          // Otherwise it's the near-duplicate (same task/project, within
          // the configurable window) warning — proceed only if the admin
          // deliberately confirms it's not a mistake.
          const when = body?.duplicate ? formatDateTime(body.duplicate.punch_time) : 'around this time';
          const proceed = window.confirm(
            `${err.message}\n\nExisting punch: ${when}.\n\nSave this punch anyway?`
          );
          if (!proceed) {
            setSubmitting(false);
            return;
          }
          punch = await submitPunch(punchTime, true);
        } else {
          throw err;
        }
      }
      onSuccess(punch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEditing ? 'save' : 'add'} the punch. Please try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? 'Edit Punch' : 'Add Punch'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {lockEmployee || isEditing ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Employee</span>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {employees.find((e) => e.emp_id === empId)?.name ?? empId}
            </div>
          </div>
        ) : (
          <Select value={empId} onChange={setEmpId} label="Employee" id="add-punch-emp">
            <option value="">Select employee…</option>
            {employees.map((e) => (
              <option key={e.emp_id} value={e.emp_id}>{e.name} ({e.emp_id})</option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input value={date} onChange={setDate} label="Date" id="add-punch-date" type="date" />
          <Input value={time} onChange={setTime} label="Time" id="add-punch-time" type="time" lang="en-US" />
        </div>

        <Select
          value={selectedKey}
          onChange={setSelectedKey}
          label="Task"
          id="add-punch-task"
          disabled={!punchableTasks}
        >
          {!punchableTasks ? (
            <option value="">{loadingTasks ? 'Loading…' : 'Select employee and date first'}</option>
          ) : punchableTasks.length === 0 ? (
            <option value="" disabled>No assigned task or default project for this date</option>
          ) : (
            <>
              <option value="">Select task…</option>
              {punchableTasks.map((t) => (
                <option key={taskKey(t)} value={taskKey(t)}>
                  {t.display_id ? `${t.display_id} — ${t.name}` : t.name}
                </option>
              ))}
            </>
          )}
        </Select>
        <p className="text-xs text-slate-400">
          Required. Only tasks the employee is assigned on this date (or their department default, if none) are selectable.
        </p>

        {selectedTask && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Project</span>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {selectedTask.project_code}{selectedTask.is_default ? ' (department default)' : ''}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Entered By</span>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {session?.name ?? session?.empId}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          This punch is {isEditing ? 'saved' : 'added'} exactly at the date/time set above and is auto-approved immediately — no separate review.
        </p>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !isComplete} className="flex-1">
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> {isEditing ? 'Saving…' : 'Adding…'}</>) : (isEditing ? 'Save Changes' : 'Add Punch')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
