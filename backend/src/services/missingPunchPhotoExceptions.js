const pool = require('../db');
const { OUT_PHOTO_WINDOW_HOURS } = require('./punchPhotoStorage');

/**
 * Sweeps for task punches whose photo was never added and never can be
 * again — raises a missing_punch_photo exception for each (same shape/
 * dedupe pattern as raiseSinglePunchException in attendance.js). This is
 * the ONLY place that exception type gets raised.
 *
 * Photos are optional at punch time (2026-09-16) — punching in/out never
 * blocks on one. Both directions are swept here, symmetrically:
 *   - a missing OUT-photo, once OUT_PHOTO_WINDOW_HOURS has passed since
 *     that punch (an admin waits a bit before flagging it, same as before
 *     photos were optional)
 *   - a missing IN-photo, once the task itself is Completed (its own
 *     out-punch already recorded) — there's no separate time window for
 *     this side since routes/punches.js already refuses the upload
 *     outright once the task closes (can't add it "soon", only "now or
 *     never"), so there's nothing to wait out.
 */
async function sweepMissingPunchPhotos() {
  const outPhotoCandidates = await pool.query(
    `SELECT p.id, p.emp_id, p.task_id, p.punch_time
     FROM punches p
     WHERE p.task_id IS NOT NULL
       AND p.photo_path IS NULL
       AND p.punch_time <= now() - ($1 || ' hours')::interval
       AND EXISTS (SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time < p.punch_time)`,
    [OUT_PHOTO_WINDOW_HOURS]
  );

  const inPhotoCandidates = await pool.query(
    `SELECT p.id, p.emp_id, p.task_id, p.punch_time
     FROM punches p
     WHERE p.task_id IS NOT NULL
       AND p.photo_path IS NULL
       AND EXISTS (SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time > p.punch_time)`
  );

  let raised = 0;
  const checked = outPhotoCandidates.rows.length + inPhotoCandidates.rows.length;

  for (const punch of outPhotoCandidates.rows) {
    const wasRaised = await raiseIfNotOpen(
      punch,
      `Employee ${punch.emp_id}'s out-photo for task ${punch.task_id} (closed ${punch.punch_time.toISOString()}) was never uploaded within the ${OUT_PHOTO_WINDOW_HOURS}h window.`
    );
    if (wasRaised) raised++;
  }

  for (const punch of inPhotoCandidates.rows) {
    const wasRaised = await raiseIfNotOpen(
      punch,
      `Employee ${punch.emp_id}'s in-photo for task ${punch.task_id} was never uploaded before the task was closed — it can no longer be added.`
    );
    if (wasRaised) raised++;
  }

  return { checked, raised };
}

async function raiseIfNotOpen(punch, details) {
  const existing = await pool.query(
    `SELECT id FROM exceptions
     WHERE type = 'missing_punch_photo' AND ref_table = 'punches' AND ref_id = $1 AND status = 'open'`,
    [punch.id]
  );
  if (existing.rows.length > 0) return false;

  await pool.query(
    `INSERT INTO exceptions (type, emp_id, ref_table, ref_id, details, status)
     VALUES ('missing_punch_photo', $1, 'punches', $2, $3, 'open')`,
    [punch.emp_id, punch.id, details]
  );
  return true;
}

module.exports = { sweepMissingPunchPhotos };
