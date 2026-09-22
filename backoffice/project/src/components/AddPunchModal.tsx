import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { addAdminPunchCorrection, updatePunch, updateTaskProject, fetchPunchableTasks, ApiError } from '@/lib/api';
import type { Employee, Punch, PunchableTask, Project } from '@/lib/api';
import { Modal, Button, Select, Input, Textarea } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useAuth } from '@/lib/auth';
import { formatDateTime, googleMapsUrl } from '@/lib/utils';

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
  projects,
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
  // Only needed for the Project field below (2026-09-22) — omitted
  // entirely by callers (e.g. Exceptions) that never edit an existing punch
  // against a real task, so that field simply never renders there.
  projects?: Project[];
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
  const [outRemark, setOutRemark] = useState('');
  // The currently-selected TASK's own project — independent of, and saved
  // separately from, which task the punch itself is against (2026-09-22).
  // Reassigning the punch to a different task (the Task field below) never
  // touches this; correcting it here never touches which task the punch is
  // against. Reset below whenever the Task selection itself changes.
  const [taskProjectCode, setTaskProjectCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null = not yet resolved for the current employee/date (either one is
  // still blank, or the fetch hasn't returned) — the task field stays
  // disabled until this is a real array, so there's never a moment where
  // an arbitrary task is selectable.
  const [punchableTasks, setPunchableTasks] = useState<PunchableTask[] | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  // Whichever task/project is currently open for this employee on this
  // date, if any (from the same fetch as punchableTasks) — lets Add Punch
  // require the closing remark exactly when this punch would close it.
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [openProjectCode, setOpenProjectCode] = useState<string | null>(null);

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
    setOutRemark('');
    setError(null);
    setPunchableTasks(null);
    setOpenTaskId(null);
    setOpenProjectCode(null);
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
      setOpenTaskId(null);
      setOpenProjectCode(null);
      return;
    }
    let cancelled = false;
    setLoadingTasks(true);
    fetchPunchableTasks(empId, date)
      .then((result) => {
        if (cancelled) return;
        setOpenTaskId(result.open_task_id);
        setOpenProjectCode(result.open_project_code);
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

  // Resets the Project field to whichever task is now selected any time
  // that selection changes (2026-09-22) — picking a DIFFERENT task must
  // never carry over a project edit that was meant for the previous one.
  // Only real tasks (a non-null id) have a project independently correctable
  // this way; the department-default fallback has no task record to correct
  // — editing that one's project is still just editing the punch itself,
  // via the Task field above, unchanged.
  useEffect(() => {
    setTaskProjectCode(selectedTask?.id !== null && selectedTask?.id !== undefined ? selectedTask.project_code : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // True only when editing an existing punch against a real task (not the
  // department-default fallback) and the admin has actually picked a
  // different project for that task than the one it currently has.
  const taskProjectChanged =
    isEditing && selectedTask?.id !== null && selectedTask?.id !== undefined &&
    !!taskProjectCode && taskProjectCode !== selectedTask.project_code;

  // Whether the punch about to be added would CLOSE the currently-open
  // task/project — same rule the backend enforces (2026-09-14), only ever
  // asked when adding, never when editing an existing punch (out of scope
  // for Edit Punch — that flow doesn't touch out_remark at all).
  const isClosingPunch =
    !isEditing &&
    !!selectedTask &&
    (selectedTask.id !== null ? selectedTask.id === openTaskId : selectedTask.project_code === openProjectCode);

  // Task, date, and time are all mandatory — a punch with any of them
  // missing is meaningless, so Submit stays disabled until the form is
  // genuinely complete rather than only validating after the fact. The
  // closing remark joins that list exactly when this punch would close.
  const isComplete = !!empId && !!selectedKey && !!date && !!time && (!isClosingPunch || !!outRemark.trim());

  // punchTime is only ever meaningful for a genuinely new backfilled punch
  // (admin-correction) — editing an existing one never touches its time at
  // all (2026-09-22), so this parameter is simply unused on that branch.
  async function submitPunch(punchTime: string, force: boolean) {
    const taskId = selectedTask?.id ?? null;
    const projectCode = taskId ? null : selectedTask?.project_code ?? null;

    if (isEditing) {
      return updatePunch(editingPunch!.id, { taskId, projectCode, force });
    }
    return addAdminPunchCorrection({
      empId,
      taskId,
      projectCode,
      punchTime,
      outRemark: isClosingPunch ? outRemark.trim() : undefined,
      force,
    });
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
    if (isClosingPunch && !outRemark.trim()) {
      setError('A remark is required to close this task.');
      return;
    }

    setSubmitting(true);
    try {
      // Runs first, and deliberately NOT inside the near-duplicate-retry
      // try/catch below (2026-09-22) — this is an entirely separate write
      // (the task's own project_code, not the punch), so its own errors
      // (closed project, duplicate task, already-fully-approved) must
      // surface as plain messages, never get mistaken for submitPunch's
      // near-duplicate-punch 409 and offered that confirm-and-retry dialog.
      if (taskProjectChanged && selectedTask?.id !== null && selectedTask?.id !== undefined) {
        await updateTaskProject(selectedTask.id, taskProjectCode);
      }

      const punchTime = localDateTimeToIso(date, time);
      let punch;
      try {
        punch = await submitPunch(punchTime, false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { duplicate?: { punch_time: string } } | null;
          // Only the near-duplicate warning (same task/project, within the
          // configurable window) is ever retry-with-force-eligible — its
          // body always carries `duplicate`. Everything else 409s (a cross-
          // task/project timestamp clash, something else already open that
          // day, or — 2026-09-14 — editing a punch that's no longer pending,
          // which force can never fix since retrying hits the exact same
          // block) is a hard stop: surface as a plain error, never a
          // confirm-and-retry dialog.
          if (!body?.duplicate) {
            throw err;
          }
          const when = formatDateTime(body.duplicate.punch_time);
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
          <SearchableSelect
            value={empId}
            onChange={setEmpId}
            label="Employee"
            id="add-punch-emp"
            placeholder="Select employee…"
            searchPlaceholder="Search by name or ID…"
            emptyMessage="No employees match."
            options={employees.map((e) => ({ value: e.emp_id, label: e.name, sublabel: e.emp_id }))}
          />
        )}

        {isEditing ? (
          // Punch time is never editable, at any stage, by anyone
          // (2026-09-22) — shown read-only for reference only. What the
          // punch was FOR (task/project below) is still correctable; when
          // it happened is permanent.
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Punch Time</span>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {formatDateTime(editingPunch!.punch_time)}
            </div>
            <p className="text-xs text-slate-400">
              Never editable — the recorded moment is permanent. Only the task/project can be corrected.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Input value={date} onChange={setDate} label="Date" id="add-punch-date" type="date" />
            <Input value={time} onChange={setTime} label="Time" id="add-punch-time" type="time" lang="en-US" />
          </div>
        )}

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

        {selectedTask && isEditing && selectedTask.id !== null ? (
          // Corrects the TASK's own project — independent of, and saved
          // separately from, the Task field above (2026-09-22). This is
          // NOT "which project is this punch against" (that's what
          // reassigning Task itself does); it's "this task was logged
          // against the wrong project, fix the task record." Restricted to
          // OPEN projects, same restriction task creation already enforces
          // — plus the task's own current project, even if that one has
          // since closed, so the field never looks like it's showing
          // nothing selected.
          <SearchableSelect
            value={taskProjectCode}
            onChange={setTaskProjectCode}
            label="Project"
            id="add-punch-task-project"
            placeholder="Select project…"
            searchPlaceholder="Search by code or name…"
            emptyMessage="No projects match."
            options={(projects ?? [])
              .filter((p) => p.status === 'OPEN' || p.project_code === selectedTask.project_code)
              .map((p) => ({
                value: p.project_code,
                label: p.project_code,
                sublabel: (p.project_name ?? '') + (p.status !== 'OPEN' ? ' (closed)' : ''),
              }))}
          />
        ) : (
          selectedTask && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Project</span>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                {selectedTask.project_code}{selectedTask.is_default ? ' (department default)' : ''}
              </div>
            </div>
          )
        )}
        {selectedTask && isEditing && selectedTask.id !== null && (
          <p className="-mt-2 text-xs text-slate-400">
            Corrects this task's own project — {selectedTask.display_id ?? 'this task'} stays the same task, everywhere
            it's referenced (Tasks page, any other punch already recorded against it) picks up the correction too.
            To move this punch to a genuinely different task instead, use the Task field above.
          </p>
        )}

        {isClosingPunch && (
          <>
            <Textarea
              value={outRemark}
              onChange={setOutRemark}
              label="Remarks"
              id="add-punch-out-remark"
              placeholder="e.g. Completed cable pull, tested and confirmed working"
              rows={3}
            />
            <p className="-mt-2 text-xs text-slate-400">
              Required — this punch closes the selected task, same as the mobile closing-punch prompt.
            </p>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Entered By</span>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {session?.name ?? session?.empId}
          </div>
        </div>

        {isEditing && (editingPunch!.resolved_address || (editingPunch!.lat !== null && editingPunch!.lng !== null)) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Location</span>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {editingPunch!.lat !== null && editingPunch!.lng !== null ? (
                <a
                  href={googleMapsUrl(editingPunch!.lat, editingPunch!.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-700 underline decoration-dotted hover:text-teal-800"
                >
                  {editingPunch!.resolved_address ?? `${editingPunch!.lat.toFixed(5)}, ${editingPunch!.lng.toFixed(5)}`}
                </a>
              ) : (
                editingPunch!.resolved_address
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-slate-400">
          {isEditing
            ? "Its recorded time never changes. Editing doesn't change its approval status either — it stays pending until you separately approve or reject it."
            : 'This punch is added exactly at the date/time set above and is auto-approved immediately — no separate review.'}
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
