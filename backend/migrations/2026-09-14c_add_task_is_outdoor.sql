-- Summer Ban feature (2026-09-14) — Indoor/Outdoor per task. Nullable, not
-- defaulted to false: NULL means "never asked" (created outside any
-- declared Summer Ban period), distinct from an explicit "Indoor" answer.
-- Both behave identically everywhere is_outdoor is checked (`=== true`
-- gates outdoor-only logic), but NULL keeps the data honest about which
-- tasks were actually asked the question.
--
-- Run once per environment. Safely re-runnable (ADD COLUMN IF NOT EXISTS).

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_outdoor BOOLEAN;
