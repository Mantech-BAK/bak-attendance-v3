-- New "Remarks" Confirmation Sheet column — a mandatory closing note the
-- employee (or supervisor, via Scan Team Member) types when giving the OUT
-- punch for a task. Never populated on the opening punch; enforced in
-- routes/punches.js POST /, not just here.
--
-- Run once per environment. Safely re-runnable (ADD COLUMN IF NOT EXISTS).

ALTER TABLE punches ADD COLUMN IF NOT EXISTS out_remark TEXT;
