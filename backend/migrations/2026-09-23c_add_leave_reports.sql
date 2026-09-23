-- Report Leave feature (2026-09-23) — employees/supervisors report a leave
-- for a given date from the mobile app; backoffice reviews them under
-- "Reported Leaves". leave_type is a plain label (not a coded reference
-- table — there are only 5 fixed options, so a CHECK constraint is enough,
-- same spirit as employees."EmpStatus"). photo_path mirrors punches'
-- own photo_path — same private "punch-photos" Supabase Storage bucket,
-- just under a "leaves/" prefix (see punchPhotoStorage.js), viewed via
-- short-lived signed URLs generated on read, same as punch photos. Unlike a
-- punch photo, this one is optional at submit time in EITHER capture mode
-- (camera or gallery) — the mobile form itself decides whether to require it.
--
-- Run once per environment. Safely re-runnable (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS leave_reports (
  id SERIAL PRIMARY KEY,
  emp_id VARCHAR(20) NOT NULL REFERENCES employees("EmpId") ON UPDATE CASCADE,
  leave_date DATE NOT NULL,
  leave_type VARCHAR(30) NOT NULL CHECK (leave_type IN (
    'Sick Leave', 'Annual Leave', 'Emergency Leave', 'Unpaid Leave', 'Compassionate Leave'
  )),
  remarks TEXT,
  photo_path TEXT,
  photo_uploaded_at TIMESTAMP,
  reported_by VARCHAR(20) NOT NULL REFERENCES employees("EmpId") ON UPDATE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leave_reports_emp_date_idx ON leave_reports (emp_id, leave_date);
CREATE INDEX IF NOT EXISTS leave_reports_date_idx ON leave_reports (leave_date);
