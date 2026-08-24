import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { updateTask, ApiError } from '@/lib/api';
import type { Task, Project } from '@/lib/api';
import { Modal, Button, Select, Textarea, Input } from '@/components/ui';

// Admin-only task edit — same validation as creating one (project must
// exist, description required, the emp_id+day+project+description
// duplicate rule, enforced server-side). Employee is never editable here —
// reassigning a task to a different employee isn't a correction, it's a
// different task; delete and re-create instead (same convention as punch
// edit's emp_id lock).
export function EditTaskModal({
  open,
  onClose,
  task,
  projects,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  projects: Project[];
  onSuccess: (updated: Task) => void;
}) {
  const [projectCode, setProjectCode] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [locationSite, setLocationSite] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && task) {
      setProjectCode(task.project_code ?? '');
      setPriority(task.priority ?? 'medium');
      setDescription(task.description);
      setLocationSite(task.location_site ?? '');
      setTaskDate(task.task_date);
      setError(null);
    }
  }, [open, task]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!task) return;
    if (!projectCode || !description.trim() || !taskDate) {
      setError('Project, description, and task date are all required.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateTask(task.id, {
        projectCode,
        priority,
        description: description.trim(),
        locationSite: locationSite.trim() || null,
        taskDate,
      });
      onSuccess(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!task) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${task.display_id}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Employee</span>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {task.employee_name ?? task.emp_id}
          </div>
        </div>

        <Select value={projectCode} onChange={setProjectCode} label="Project" id="edit-task-project">
          <option value="">Select project…</option>
          {projects.map((p) => (
            <option key={p.project_code} value={p.project_code}>{p.project_name ?? p.project_code}</option>
          ))}
        </Select>

        <Input value={taskDate} onChange={setTaskDate} label="Task Date" id="edit-task-date" type="date" />

        <Select value={priority} onChange={setPriority} label="Priority" id="edit-task-priority">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>

        <Textarea value={description} onChange={setDescription} label="Description" id="edit-task-description" rows={4} />

        <Input value={locationSite} onChange={setLocationSite} label="Location" id="edit-task-location" placeholder="e.g. Site office, Dock 2…" />

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
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
