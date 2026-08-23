import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import { updateEmployee, ApiError } from '@/lib/api';
import type { Employee } from '@/lib/api';
import { Modal, Button, Input, Select } from '@/components/ui';

// Full-record edit — name, status, login code, OT eligibility, reporting
// manager, and EmpId itself. Department/designation/division/religion are
// deliberately not editable here: they're FK-coded fields with no
// reference-list endpoint anywhere in this app yet, so this form only
// covers what it can actually validate against real data (an employee ID
// for the reporting manager, a 5-letter login code).
export function EditEmployeeModal({
  open,
  onClose,
  employee,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  employee: Employee | null;
  onSuccess: (updated: Employee) => void;
}) {
  const [empId, setEmpId] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [loginCode, setLoginCode] = useState('');
  const [otEligible, setOtEligible] = useState('N');
  const [reportingManagerEmpId, setReportingManagerEmpId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && employee) {
      setEmpId(employee.emp_id);
      setName(employee.name);
      setStatus(employee.status);
      setLoginCode(employee.login_code ?? '');
      setOtEligible(employee.ot_eligible ?? 'N');
      setReportingManagerEmpId(employee.reporting_manager_emp_id ?? '');
      setError(null);
    }
  }, [open, employee]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!employee) return;
    if (!empId.trim() || !name.trim()) {
      setError('Employee ID and name are both required.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateEmployee(employee.emp_id, {
        newEmpId: empId.trim(),
        name: name.trim(),
        status,
        loginCode: loginCode.trim() ? loginCode.trim().toUpperCase() : null,
        otEligible: otEligible === 'Y',
        reportingManagerEmpId: reportingManagerEmpId.trim() || null,
      });
      onSuccess({
        ...employee,
        emp_id: updated.emp_id,
        name: updated.name,
        status: updated.status,
        login_code: updated.login_code,
        ot_eligible: updated.ot_eligible,
        reporting_manager_emp_id: updated.reporting_manager_emp_id,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!employee) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${employee.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input value={empId} onChange={setEmpId} label="Employee ID" id="edit-emp-id" />
        <p className="-mt-2 text-xs text-slate-400">
          Renaming updates every punch, task, and other record for this employee automatically.
        </p>

        <Input value={name} onChange={setName} label="Name" id="edit-emp-name" />

        <Select value={status} onChange={setStatus} label="Status" id="edit-emp-status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>

        <Select value={otEligible} onChange={setOtEligible} label="OT Eligible" id="edit-emp-ot">
          <option value="Y">Yes</option>
          <option value="N">No</option>
        </Select>

        <Input
          value={reportingManagerEmpId}
          onChange={setReportingManagerEmpId}
          label="Reports To (Employee ID)"
          id="edit-emp-manager"
          placeholder="e.g. E1007 (leave blank for none)"
        />

        <Input
          value={loginCode}
          onChange={(v) => setLoginCode(v.toUpperCase())}
          label="Login Code"
          id="edit-emp-login-code"
          placeholder="5 letters, e.g. ABCDE"
        />

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
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
