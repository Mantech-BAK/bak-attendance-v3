import { ClipboardList } from 'lucide-react';
import type { Employee, Task } from '@/lib/api';
import { Modal, Badge, EmptyState } from '@/components/ui';
import { punchStatus } from '@/pages/TasksPage';
import { formatDate } from '@/lib/utils';

// Opened from either Employees page view (List row or Bar card click) to
// show one employee's actual tasks for the selected date, colored by the
// same punch_count-derived status (green=completed, amber=pending,
// gray=not started) used everywhere else tasks are shown — reuses
// TasksPage's punchStatus rather than re-deriving the completed/pending
// split a second time.
export function EmployeeTasksModal({
  employee,
  date,
  tasks,
  onClose,
}: {
  employee: Employee | null;
  date: string;
  tasks: Task[];
  onClose: () => void;
}) {
  return (
    <Modal open={employee !== null} onClose={onClose} title={employee ? `${employee.name}'s Tasks — ${formatDate(date)}` : 'Tasks'}>
      {tasks.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No tasks" message="No tasks assigned to this employee on this date." />
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {tasks.map((t) => {
            const status = punchStatus(t);
            const statusVariant = status === 'completed' ? 'success' : status === 'pending' ? 'warning' : 'neutral';
            const statusLabel = status === 'completed' ? 'Completed' : status === 'pending' ? 'Pending' : 'Not Started';
            return (
              <div key={t.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-400">{t.display_id}</p>
                    <p className="text-sm font-medium text-slate-900">{t.description}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{t.project_name ?? t.project_code}</p>
                  </div>
                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
