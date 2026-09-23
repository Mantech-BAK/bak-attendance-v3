import { useEffect, useState, type FormEvent } from 'react';
import { XCircle, Loader2 } from 'lucide-react';
import {
  updateEmployee, fetchDepartments, fetchDesignations, fetchDivisions, fetchReligions, ApiError,
} from '@/lib/api';
import type { Employee, DepartmentRef, DesignationRef, DivisionRef, ReligionRef } from '@/lib/api';
import { Modal, Button, Input, Select } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';

// Full-record edit — every real employee master-data field, not just the
// ones the earlier version of this form could self-validate. Department,
// Designation, Division, and Religion are FK-coded (Designation/Division/
// Religion have real DB constraints; Department doesn't — see
// routes/employees.js's own comment on why department_name IS the value,
// not company_dept_id) and now use the same SearchableSelect dropdown
// pattern already used for Project/Employee pickers elsewhere in this app,
// backed by the new GET /api/departments|designations|divisions|religions
// reference endpoints (2026-09-23).
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
  const [isSupervisor, setIsSupervisor] = useState('N');
  const [reportingManagerEmpId, setReportingManagerEmpId] = useState('');
  const [department, setDepartment] = useState('');
  const [designationCode, setDesignationCode] = useState('');
  const [divisionCode, setDivisionCode] = useState('');
  const [religionCode, setReligionCode] = useState('');
  const [cpr, setCpr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [designations, setDesignations] = useState<DesignationRef[]>([]);
  const [divisions, setDivisions] = useState<DivisionRef[]>([]);
  const [religions, setReligions] = useState<ReligionRef[]>([]);

  useEffect(() => {
    if (open) {
      Promise.all([fetchDepartments(), fetchDesignations(), fetchDivisions(), fetchReligions()])
        .then(([dept, desig, div, rel]) => {
          setDepartments(dept);
          setDesignations(desig);
          setDivisions(div);
          setReligions(rel);
        })
        .catch(() => {
          // Reference lists failing to load just means those four dropdowns
          // show no options — the rest of the form (and every field it
          // already handled before this change) still works.
        });
    }
  }, [open]);

  useEffect(() => {
    if (open && employee) {
      setEmpId(employee.emp_id);
      setName(employee.name);
      setStatus(employee.status);
      setLoginCode(employee.login_code ?? '');
      setOtEligible(employee.ot_eligible ?? 'N');
      setIsSupervisor(employee.is_supervisor ? 'Y' : 'N');
      setReportingManagerEmpId(employee.reporting_manager_emp_id ?? '');
      setDepartment(employee.department ?? '');
      setDesignationCode(employee.designation_code ?? '');
      setDivisionCode(employee.division_code ?? '');
      setReligionCode(employee.religion_code ?? '');
      setCpr(employee.cpr ?? '');
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
        isSupervisor: isSupervisor === 'Y',
        reportingManagerEmpId: reportingManagerEmpId.trim() || null,
        department: department || null,
        designationCode: designationCode || null,
        divisionCode: divisionCode || null,
        religionCode: religionCode || null,
        cpr: cpr.trim() || null,
      });
      onSuccess({
        ...employee,
        emp_id: updated.emp_id,
        name: updated.name,
        status: updated.status,
        login_code: updated.login_code,
        ot_eligible: updated.ot_eligible,
        is_supervisor: updated.is_supervisor,
        reporting_manager_emp_id: updated.reporting_manager_emp_id,
        department: updated.department,
        designation_code: updated.designation_code,
        division_code: updated.division_code,
        religion_code: updated.religion_code,
        cpr: updated.cpr,
        designation: updated.designation,
        company: updated.company,
        religion: updated.religion,
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

        <Select value={isSupervisor} onChange={setIsSupervisor} label="Is Supervisor" id="edit-emp-is-supervisor">
          <option value="N">No</option>
          <option value="Y">Yes</option>
        </Select>
        <p className="-mt-2 text-xs text-slate-400">
          Independent of Designation — controls supervisor-only behavior (mobile role, backoffice access, punch auto-approval) regardless of job title.
        </p>

        <Input
          value={reportingManagerEmpId}
          onChange={setReportingManagerEmpId}
          label="Reports To (Employee ID)"
          id="edit-emp-manager"
          placeholder="e.g. E1007 (leave blank for none)"
        />

        <SearchableSelect
          value={department}
          onChange={setDepartment}
          label="Department"
          id="edit-emp-department"
          placeholder="Select department…"
          searchPlaceholder="Search by name…"
          emptyMessage="No departments match."
          options={departments.map((d) => ({ value: d.department_name, label: d.department_name }))}
        />

        <SearchableSelect
          value={designationCode}
          onChange={setDesignationCode}
          label="Designation"
          id="edit-emp-designation"
          placeholder="Select designation…"
          searchPlaceholder="Search by name…"
          emptyMessage="No designations match."
          options={designations.map((d) => ({ value: d.designation_code, label: d.designation_name }))}
        />

        <SearchableSelect
          value={divisionCode}
          onChange={setDivisionCode}
          label="Division"
          id="edit-emp-division"
          placeholder="Select division…"
          searchPlaceholder="Search by name…"
          emptyMessage="No divisions match."
          options={divisions.map((d) => ({ value: d.division_code, label: d.division_name }))}
        />

        <SearchableSelect
          value={religionCode}
          onChange={setReligionCode}
          label="Religion"
          id="edit-emp-religion"
          placeholder="Select religion… (optional)"
          searchPlaceholder="Search by name…"
          emptyMessage="No religions match."
          options={religions.map((r) => ({ value: r.religion_code, label: r.religion_name }))}
        />

        <Input value={cpr} onChange={setCpr} label="CPR" id="edit-emp-cpr" placeholder="National ID / CPR number (optional)" />

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
