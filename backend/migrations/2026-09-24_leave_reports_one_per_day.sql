-- One leave report per employee per date (2026-09-24). Enforced by the
-- database itself (not just a check in the route) so two simultaneous
-- submissions can't both slip through. Safely re-runnable. Fails if duplicate
-- (emp_id, leave_date) rows already exist — resolve those first.
CREATE UNIQUE INDEX IF NOT EXISTS leave_reports_emp_date_unique ON leave_reports (emp_id, leave_date);
