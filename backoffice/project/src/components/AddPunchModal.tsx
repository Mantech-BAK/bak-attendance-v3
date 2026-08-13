import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { addAdminPunchCorrection } from '@/lib/api';
import type { Employee, Project, Punch } from '@/lib/api';
import { Modal, Button, Select, Input } from '@/components/ui';

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
  const [empId, setEmpId] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [enteredBy, setEnteredBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmpId(defaultEmpId ?? '');
      setProjectCode(defaultProjectCode ?? '');
      setDate(defaultDate ?? '');
      setTime('');
      setEnteredBy('');
      setError(null);
    }
  }, [open, defaultEmpId, defaultProjectCode, defaultDate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!empId || !date || !time || !enteredBy) {
      setError('Employee, date, time, and admin are all required.');
      return;
    }

    setSubmitting(true);
    try {
      const punchTime = `${date}T${time}:00.000Z`;
      const punch = await addAdminPunchCorrection({
        empId,
        projectCode: projectCode || null,
        punchTime,
        enteredBy,
      });
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

        <Select value={projectCode} onChange={setProjectCode} label="Project" id="add-punch-project">
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.project_code} value={p.project_code}>{p.project_name ?? p.project_code}</option>
          ))}
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Input value={date} onChange={setDate} label="Date" id="add-punch-date" type="date" />
          <Input value={time} onChange={setTime} label="Time" id="add-punch-time" type="time" />
        </div>

        <Select value={enteredBy} onChange={setEnteredBy} label="Entered By (Admin)" id="add-punch-admin">
          <option value="">Select admin…</option>
          {employees.map((e) => (
            <option key={e.emp_id} value={e.emp_id}>{e.name}</option>
          ))}
        </Select>

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
