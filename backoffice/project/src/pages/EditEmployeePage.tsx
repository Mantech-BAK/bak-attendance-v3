import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import {
  fetchEmployees, updateEmployee, fetchDepartments, fetchDesignations, fetchDivisions, fetchReligions, ApiError,
} from '@/lib/api';
import type { Employee, DepartmentRef, DesignationRef, DivisionRef, ReligionRef } from '@/lib/api';
import { useRouter } from '@/lib/router';
import { PageHeader } from '@/components/PageHeader';
import { Card, Button, Input, Select, Spinner, EmptyState } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';

// Full-page employee editor (2026-09-24), replacing the old EditEmployeeModal.
// The modal had no max-height/scroll, so once every master-data field became
// editable the form grew taller than the screen and its Save button ended up
// off-screen and unreachable — edits looked like they "didn't save" because
// they could never actually be submitted. A normal scrolling page with a
// sticky action bar can't have that failure.
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">{children}</div>
    </Card>
  );
}

export function EditEmployeePage({ empId }: { empId: string }) {
  const { navigate } = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [newEmpId, setNewEmpId] = useState('');
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

  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [designations, setDesignations] = useState<DesignationRef[]>([]);
  const [divisions, setDivisions] = useState<DivisionRef[]>([]);
  const [religions, setReligions] = useState<ReligionRef[]>([]);
  const [managers, setManagers] = useState<Employee[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchEmployees(), fetchDepartments(), fetchDesignations(), fetchDivisions(), fetchReligions()])
      .then(([emps, dept, desig, div, rel]) => {
        if (cancelled) return;
        const found = emps.find((e) => e.emp_id === empId) ?? null;
        setDepartments(dept);
        setDesignations(desig);
        setDivisions(div);
        setReligions(rel);
        setManagers(emps);
        if (!found) {
          setNotFound(true);
        } else {
          setEmployee(found);
          setNewEmpId(found.emp_id);
          setName(found.name);
          setStatus(found.status);
          setLoginCode(found.login_code ?? '');
          setOtEligible(found.ot_eligible ?? 'N');
          setIsSupervisor(found.is_supervisor ? 'Y' : 'N');
          setReportingManagerEmpId(found.reporting_manager_emp_id ?? '');
          setDepartment(found.department ?? '');
          setDesignationCode(found.designation_code ?? '');
          setDivisionCode(found.division_code ?? '');
          setReligionCode(found.religion_code ?? '');
          setCpr(found.cpr ?? '');
        }
      })
      .catch(() => { if (!cancelled) setError('Could not load this employee. Please go back and try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [empId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!employee) return;
    if (!newEmpId.trim() || !name.trim()) {
      setError('Employee ID and name are both required.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSubmitting(true);
    try {
      await updateEmployee(employee.emp_id, {
        newEmpId: newEmpId.trim(),
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
      setSaved(true);
      // The Employees page refetches on mount, so it shows the saved values
      // as soon as it opens — brief success state first so it's clear the
      // save actually went through.
      setTimeout(() => navigate('employees'), 350);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes. Please try again.');
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const backButton = (
    <Button variant="secondary" onClick={() => navigate('employees')}>
      <ArrowLeft className="h-4 w-4" /> Back to Employees
    </Button>
  );

  if (loading) {
    return (<><PageHeader title="Edit Employee" action={backButton} /><Spinner /></>);
  }

  if (notFound || !employee) {
    return (
      <>
        <PageHeader title="Edit Employee" action={backButton} />
        <Card className="p-6">
          <EmptyState icon={<XCircle className="h-6 w-6" />} title="Employee not found" message={error ?? `No employee with ID ${empId}.`} />
        </Card>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <PageHeader title={`Edit ${employee.name}`} subtitle={`Employee ID ${employee.emp_id}`} action={backButton} />

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="space-y-6 pb-4">
        <Section title="Identity" description="Renaming the Employee ID updates every punch, task, and other record for this employee automatically.">
          <Input value={newEmpId} onChange={setNewEmpId} label="Employee ID" id="edit-emp-id" />
          <Input value={name} onChange={setName} label="Name" id="edit-emp-name" />
          <Input value={cpr} onChange={setCpr} label="CPR" id="edit-emp-cpr" placeholder="National ID / CPR number (optional)" />
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
        </Section>

        <Section title="Organisation">
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
            value={reportingManagerEmpId}
            onChange={setReportingManagerEmpId}
            label="Reports To"
            id="edit-emp-manager"
            placeholder="No manager"
            searchPlaceholder="Search by name or ID…"
            emptyMessage="No employees match."
            options={[
              { value: '', label: 'No manager' },
              ...managers.filter((m) => m.emp_id !== employee.emp_id).map((m) => ({ value: m.emp_id, label: m.name, sublabel: m.emp_id })),
            ]}
          />
        </Section>

        <Section title="Access & Status">
          <Select value={status} onChange={setStatus} label="Status" id="edit-emp-status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Select value={otEligible} onChange={setOtEligible} label="OT Eligible" id="edit-emp-ot">
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </Select>
          <div>
            <Select value={isSupervisor} onChange={setIsSupervisor} label="Is Supervisor" id="edit-emp-is-supervisor">
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </Select>
            <p className="mt-1.5 text-xs text-slate-400">
              Independent of Designation — controls supervisor-only behavior (mobile role, backoffice access, punch auto-approval).
            </p>
          </div>
          <Input
            value={loginCode}
            onChange={(v) => setLoginCode(v.toUpperCase())}
            label="Login Code"
            id="edit-emp-login-code"
            placeholder="5 letters, e.g. ABCDE"
          />
        </Section>
      </div>

      <div className="sticky bottom-0 -mx-8 mt-2 border-t border-slate-200 bg-white/90 px-8 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-3">
          {saved && (
            <span className="mr-auto flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Saved — returning to Employees…
            </span>
          )}
          <Button type="button" variant="secondary" onClick={() => navigate('employees')} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className="min-w-[10rem]">
            {saved ? (<><CheckCircle2 className="h-4 w-4" /> Saved</>)
              : submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>)
              : 'Save Changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
