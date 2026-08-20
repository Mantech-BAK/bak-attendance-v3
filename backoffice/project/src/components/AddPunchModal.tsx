import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { addAdminPunchCorrection, fetchPunchableProjects, ApiError } from '@/lib/api';
import type { Employee, Project, Punch } from '@/lib/api';
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
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

// Admin-only manual punch correction — sets an explicit timestamp (never
// "now") and is auto-approved immediately, no review queue. Shared between
// the Punches page (general "Add Punch") and the Exceptions page (contextual
// "Add Punch" on a single_punch_only card, with employee/project/date
// pre-filled from the existing incomplete punch).
export function AddPunchModal({
  open,
  onClose,
  employees,
  projects,
  defaultEmpId,
  defaultProjectCode,
  defaultDate,
  lockEmployee,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  projects: Project[];
  defaultEmpId?: string;
  defaultProjectCode?: string | null;
  defaultDate?: string;
  lockEmployee?: boolean;
  onSuccess: (punch: Punch) => void;
}) {
  const { session } = useAuth();
  const [empId, setEmpId] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null = not yet resolved for the current employee/date (either one is
  // still blank, or the fetch hasn't returned) — the project field stays
  // disabled until this is a real Set, so there's never a moment where every
  // project is selectable.
  const [punchableCodes, setPunchableCodes] = useState<Set<string> | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    if (open) {
      setEmpId(defaultEmpId ?? '');
      setProjectCode(defaultProjectCode ?? '');
      setDate(defaultDate ?? '');
      setTime('');
      setError(null);
      setPunchableCodes(null);
    }
  }, [open, defaultEmpId, defaultProjectCode, defaultDate]);

  // Restricts the Project field to only what this employee could legitimately
  // punch on this date: a project they have a real task for, or (absent any
  // task) their department default — never an arbitrary project off a free
  // dropdown. defaultProjectCode (the Exceptions flow's in-progress punch
  // being completed) is always allowed too, even on the rare chance it isn't
  // in that set, since it's the specific real punch the admin is correcting.
  useEffect(() => {
    if (!open || !empId || !date) {
      setPunchableCodes(null);
      return;
    }
    let cancelled = false;
    setLoadingProjects(true);
    fetchPunchableProjects(empId, date)
      .then((result) => {
        if (cancelled) return;
        const codes = new Set(result.projects.map((p) => p.project_code));
        if (defaultProjectCode) codes.add(defaultProjectCode);
        setPunchableCodes(codes);
      })
      .catch(() => {
        if (!cancelled) setPunchableCodes(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, empId, date, defaultProjectCode]);

  // If the employee or date changes out from under a previously valid
  // selection, don't leave a now-invalid project silently selected.
  useEffect(() => {
    if (punchableCodes && projectCode && !punchableCodes.has(projectCode)) {
      setProjectCode('');
    }
  }, [punchableCodes, projectCode]);

  const selectableProjects = punchableCodes
    ? projects.filter((p) => punchableCodes.has(p.project_code))
    : [];

  async function submitPunch(punchTime: string, force: boolean) {
    return addAdminPunchCorrection({
      empId,
      projectCode: projectCode || null,
      punchTime,
      force,
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!empId || !date || !time) {
      setError('Employee, date, and time are all required.');
      return;
    }

    setSubmitting(true);
    try {
      const punchTime = localDateTimeToIso(date, time);
      let punch;
      try {
        punch = await submitPunch(punchTime, false);
      } catch (err) {
        // 409 = a near-identical punch already exists (see
        // DUPLICATE_WINDOW_MINUTES on the backend) — warn, and only proceed
        // if the admin deliberately confirms it's not a mistake. Any other
        // error falls through to the normal inline error message below.
        if (err instanceof ApiError && err.status === 409) {
          const duplicate = (err.body as { duplicate?: { punch_time: string } } | null)?.duplicate;
          const when = duplicate ? formatDateTime(duplicate.punch_time) : 'around this time';
          const proceed = window.confirm(
            `${err.message}\n\nExisting punch: ${when}.\n\nAdd this punch anyway?`
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
      setError(err instanceof Error ? err.message : 'Could not add the punch. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Punch">
      <form onSubmit={handleSubmit} className="space-y-4">
        {lockEmployee ? (
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

        <Select
          value={projectCode}
          onChange={setProjectCode}
          label="Project"
          id="add-punch-project"
          disabled={!punchableCodes}
        >
          {!punchableCodes ? (
            <option value="">{loadingProjects ? 'Loading…' : 'Select employee and date first'}</option>
          ) : (
            <>
              <option value="">No project</option>
              {selectableProjects.length === 0 && (
                <option value="__none__" disabled>No assigned task or default project for this date</option>
              )}
              {selectableProjects.map((p) => (
                <option key={p.project_code} value={p.project_code}>{p.project_name ?? p.project_code}</option>
              ))}
            </>
          )}
        </Select>
        <p className="text-xs text-slate-400">
          Only projects the employee has a real task for on this date (or their department default, if none) are selectable.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Input value={date} onChange={setDate} label="Date" id="add-punch-date" type="date" />
          <Input value={time} onChange={setTime} label="Time" id="add-punch-time" type="time" />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Entered By</span>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {session?.name ?? session?.empId}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          This punch is added exactly at the date/time set above and is auto-approved immediately — no separate review.
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
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Adding…</>) : 'Add Punch'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
