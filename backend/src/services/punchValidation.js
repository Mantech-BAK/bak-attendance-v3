const pool = require('../db');
const { getOpenPunchForDate, punchKey, dateKey } = require('./attendance');
const { getDuplicatePunchWindowMinutes } = require('./settings');

class PunchValidationError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

/**
 * Resolves what a punch is actually being recorded against — a specific
 * task (project auto-filled and locked from it) or, for the department-
 * default fallback with no real task assigned, a bare project_code. Exactly
 * one of task_id/project_code should be supplied by the caller; task_id
 * wins if both are somehow present, since a chosen task's project is never
 * client-editable.
 *
 * Validates the task actually belongs to emp_id (an admin/employee can't
 * punch a task assigned to someone else) and that the resolved project
 * exists. Returns { task_id, project_code } — project_code always populated
 * (denormalized copy of the task's own project when task-based), task_id
 * null for the fallback case.
 */
async function resolvePunchTarget({ emp_id, task_id, project_code }) {
  if (task_id !== undefined && task_id !== null) {
    const taskResult = await pool.query(
      'SELECT id, emp_id, project_code FROM tasks WHERE id = $1',
      [task_id]
    );
    if (taskResult.rows.length === 0) {
      throw new PunchValidationError(400, `task ${task_id} not found`);
    }
    const task = taskResult.rows[0];
    if (task.emp_id !== emp_id) {
      throw new PunchValidationError(400, `task ${task_id} is not assigned to ${emp_id}`);
    }
    return { task_id: task.id, project_code: task.project_code };
  }

  if (!project_code) {
    return { task_id: null, project_code: null };
  }

  const projectResult = await pool.query('SELECT project_code FROM projects WHERE project_code = $1', [project_code]);
  if (projectResult.rows.length === 0) {
    throw new PunchValidationError(400, `project ${project_code} not found`);
  }
  return { task_id: null, project_code };
}

/**
 * Real tasks are fully independent of each other — Task A being open never
 * blocks Task B from opening too, even under the same project. That's what
 * "per-task" actually means (2026-08-23 product decision) and it's what
 * lets a genuine nested session happen through the normal punch flow: open
 * A, open B without closing A first, close B, then come back and close A
 * (see applyNestedSubtraction, which is what turns that into correctly
 * subtracted real time). There is no "only one task open at a time"
 * invariant left to enforce for real tasks — the only question punching a
 * task ever asks is "is THIS task currently open" (even/odd count), which
 * decides IN vs OUT and never blocks.
 *
 * The department-default fallback (task_id null, bare project_code) is the
 * one case that still enforces "only one open at a time" — exactly as it
 * worked before per-task tracking existed — since there's no task identity
 * to distinguish concurrent fallback punches by.
 *
 * excludePunchId lets an edit check "would this change leave an open
 * conflict" without the punch being edited counting against itself.
 */
async function checkOpenConflict({ emp_id, task_id, project_code, date, excludePunchId }) {
  if (task_id) return;

  const open = await getOpenPunchForDate(emp_id, date, excludePunchId);
  if (!open || open.task_id) return; // nothing open, or what's open is a real (independent) task
  if (open.project_code === project_code) return; // closing the same open fallback project

  throw new PunchValidationError(409, `${emp_id} has an open punch for project ${open.project_code} on ${date} — close it before punching a different project`, {
    open_task_id: null,
    open_project_code: open.project_code,
  });
}

function describeKey({ task_id, project_code }) {
  return task_id ? `task ${task_id}` : `project ${project_code}`;
}

/**
 * Two different tasks/projects sharing the exact same instant is ambiguous:
 * the even/odd open check and First-In-Last-Out session logic both depend
 * on every punch having a genuine chronological order, and two punches at
 * the identical timestamp have none. Hard block — not skippable via force,
 * since there's no legitimate correction that needs it, only a broken
 * ordering.
 */
async function checkCrossKeyTimestampClash({ emp_id, task_id, project_code, punchTime, excludePunchId }) {
  const params = [emp_id, task_id ?? null, project_code, punchTime];
  let sql = `
    SELECT id, task_id, project_code, punch_time
    FROM punches
    WHERE emp_id = $1
      AND (task_id IS NOT NULL OR project_code IS NOT NULL)
      AND NOT (task_id IS NOT DISTINCT FROM $2 AND project_code IS NOT DISTINCT FROM $3)
      AND punch_time = $4::timestamp`;
  if (excludePunchId) {
    params.push(excludePunchId);
    sql += ` AND id != $${params.length}`;
  }
  sql += ' LIMIT 1';

  const result = await pool.query(sql, params);
  if (result.rows.length === 0) return;

  const clash = result.rows[0];
  throw new PunchValidationError(409, `${emp_id} already has a punch for ${describeKey(clash)} at this exact time — punches for different tasks/projects cannot share the same timestamp.`, {
    conflicting_punch: clash,
  });
}

/**
 * A second punch for the same key within the configurable window of an
 * existing one is flagged as a likely duplicate — close enough in time
 * that it's far more likely a double-submit than two genuinely distinct
 * corrections, but not blocked outright since an admin occasionally does
 * need two close entries. Skippable via force, once the admin has
 * confirmed it's not a mistake.
 */
async function checkNearDuplicate({ emp_id, task_id, project_code, punchTime, excludePunchId, force }) {
  if (force) return;

  const windowMinutes = await getDuplicatePunchWindowMinutes();
  const params = [emp_id, task_id ?? null, project_code, punchTime, windowMinutes];
  let sql = `
    SELECT id, punch_time, entry_method, approval_status
    FROM punches
    WHERE emp_id = $1
      AND task_id IS NOT DISTINCT FROM $2
      AND project_code IS NOT DISTINCT FROM $3
      AND punch_time BETWEEN $4::timestamp - (INTERVAL '1 minute' * $5) AND $4::timestamp + (INTERVAL '1 minute' * $5)`;
  if (excludePunchId) {
    params.push(excludePunchId);
    sql += ` AND id != $${params.length}`;
  }
  sql += ' ORDER BY punch_time LIMIT 1';

  const result = await pool.query(sql, params);
  if (result.rows.length === 0) return;

  throw new PunchValidationError(409, `${emp_id} already has a punch for this ${task_id ? 'task' : 'project'} within ${windowMinutes} minutes of this time.`, {
    duplicate: result.rows[0],
  });
}

module.exports = {
  PunchValidationError,
  resolvePunchTarget,
  checkOpenConflict,
  checkCrossKeyTimestampClash,
  checkNearDuplicate,
  describeKey,
};
