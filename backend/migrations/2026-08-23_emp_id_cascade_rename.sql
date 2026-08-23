-- Enables safely renaming an employee's EmpId (the primary key) from the
-- backoffice Employees edit form. Without ON UPDATE CASCADE, renaming an
-- EmpId with any punches/tasks/ot_approvals/confirmation_sheet_records rows
-- would fail outright (FK violation), and EmpReportMgrId (the org-chart
-- link) wasn't FK-constrained at all, so a rename would have silently
-- orphaned every direct report's reporting-manager reference.
--
-- Run once per environment. Idempotent — safe to re-run.

BEGIN;

ALTER TABLE tasks DROP CONSTRAINT tasks_emp_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_emp_id_fkey
  FOREIGN KEY (emp_id) REFERENCES employees("EmpId") ON UPDATE CASCADE;

ALTER TABLE punches DROP CONSTRAINT punches_emp_id_fkey;
ALTER TABLE punches ADD CONSTRAINT punches_emp_id_fkey
  FOREIGN KEY (emp_id) REFERENCES employees("EmpId") ON UPDATE CASCADE;

ALTER TABLE ot_approvals DROP CONSTRAINT ot_approvals_emp_id_fkey;
ALTER TABLE ot_approvals ADD CONSTRAINT ot_approvals_emp_id_fkey
  FOREIGN KEY (emp_id) REFERENCES employees("EmpId") ON UPDATE CASCADE;

ALTER TABLE confirmation_sheet_records DROP CONSTRAINT "confirmation_sheet_records_EmpId_fkey";
ALTER TABLE confirmation_sheet_records ADD CONSTRAINT "confirmation_sheet_records_EmpId_fkey"
  FOREIGN KEY ("EmpId") REFERENCES employees("EmpId") ON UPDATE CASCADE;

-- EmpReportMgrId had no FK constraint at all before this — added fresh.
-- Verified before adding: no existing EmpReportMgrId value is orphaned
-- (every non-null value matches a real employees.EmpId).
ALTER TABLE employees ADD CONSTRAINT employees_empreportmgrid_fkey
  FOREIGN KEY ("EmpReportMgrId") REFERENCES employees("EmpId") ON UPDATE CASCADE;

COMMIT;
