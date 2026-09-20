-- Fixes real (not perceived) slowness on every backoffice list that reads
-- punches: GET /api/punches, GET /api/punches/pending, and GET /api/tasks
-- all compute an is_in_punch / punch_count value with a per-row correlated
-- subquery against the punches table (task_id = ... AND punch_time < ...,
-- or task_id = ... AND approval_status <> 'rejected'). With no index other
-- than the primary key, every one of those subqueries was a sequential scan
-- of the whole punches table, run once per outer row — cost grows with the
-- SQUARE of punches as the table accumulates real device data over time,
-- not linearly. That's what read as backoffice "buffering" on stat-card /
-- tile clicks that hit these endpoints (Punches, Tasks, Approvals), and
-- would only get worse over time, not better, if left alone.
--
-- (task_id, punch_time) is the leading pair every one of those correlated
-- subqueries filters/compares on, so a single composite index covers all
-- three call sites: Postgres can satisfy "same task_id, earlier punch_time"
-- and "same task_id, count regardless of time" with an index range scan
-- instead of a full-table scan per row.
--
-- Purely additive (CREATE INDEX, no data/shape change) — safe to run
-- against a live database with no downtime, and safely re-runnable via the
-- IF NOT EXISTS guard.

CREATE INDEX IF NOT EXISTS idx_punches_task_id_punch_time ON punches (task_id, punch_time);

-- Also backs GET /api/punches' unfiltered "ORDER BY p.punch_time DESC" and
-- GET /api/tasks' unfiltered "ORDER BY t.created_at DESC" — both currently
-- full-table sorts with no WHERE clause, same growth problem as above.
CREATE INDEX IF NOT EXISTS idx_punches_punch_time ON punches (punch_time DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC);
