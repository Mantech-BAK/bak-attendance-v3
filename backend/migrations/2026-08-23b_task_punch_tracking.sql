-- Per-task punch tracking: punches now reference a specific task (not just
-- a project), so two tasks sharing the same project get independently
-- calculated real time instead of being merged into one session. The
-- default-project fallback (no real task assigned) is untouched — those
-- punches keep task_id NULL and stay purely project_code-based, exactly as
-- today.
--
-- Also adds tasks.display_id — a human-readable TASK-DDMMYYYY-XXX reference
-- id, auto-assigned at creation, sequential per calendar day (by the task's
-- own task_date, not creation date). task_id_counters backs that sequence
-- with a single atomic UPSERT so concurrent creates (e.g. bulk upload) can
-- never collide.
--
-- Run once per environment. Not safely re-runnable (no IF NOT EXISTS guards
-- on the backfill) — check pg_attribute first if unsure whether this has
-- already been applied.

BEGIN;

ALTER TABLE punches ADD COLUMN task_id INTEGER REFERENCES tasks(id);

CREATE TABLE task_id_counters (
  task_date DATE PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE tasks ADD COLUMN display_id VARCHAR(20);

-- Backfill every existing task with a display_id, numbered sequentially
-- within its own task_date (ordered by id, i.e. creation order) — mirrors
-- exactly how new tasks will be numbered going forward.
WITH numbered AS (
  SELECT id, task_date,
         row_number() OVER (PARTITION BY task_date ORDER BY id) AS rn
  FROM tasks
)
UPDATE tasks t
SET display_id = 'TASK-' || to_char(numbered.task_date, 'DDMMYYYY') || '-' || lpad(numbered.rn::text, 3, '0')
FROM numbered
WHERE t.id = numbered.id;

-- Seed task_id_counters so the next real task created for a date that
-- already has backfilled tasks continues the sequence instead of
-- restarting at 001.
INSERT INTO task_id_counters (task_date, counter)
SELECT task_date, count(*) FROM tasks GROUP BY task_date
ON CONFLICT (task_date) DO UPDATE SET counter = EXCLUDED.counter;

ALTER TABLE tasks ALTER COLUMN display_id SET NOT NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_display_id_key UNIQUE (display_id);

COMMIT;
