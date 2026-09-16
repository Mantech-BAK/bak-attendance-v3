const pool = require('../db');
const { OUT_PHOTO_WINDOW_HOURS } = require('./punchPhotoStorage');

/**
 * Sweeps for out-punches whose OUT_PHOTO_WINDOW_HOURS window has lapsed
 * with no photo ever uploaded, and raises a missing_punch_photo exception
 * for each (same shape/dedupe pattern as raiseSinglePunchException in
 * attendance.js). This is the ONLY place that exception type gets raised —
 * the live block in routes/punches.js POST / only ever blocks a NEW punch
 * within the window; once the window lapses, that block stops applying
 * (see punchPhotoStorage.js's OUT_PHOTO_WINDOW_HOURS comment) and this sweep
 * is what surfaces the still-missing photo to an admin instead.
 *
 * Never touches in-photos — those stay an indefinite, un-windowed block on
 * that task's own out-punch (the employee is still actively on that exact
 * task and can resolve it anytime before closing it), not something that
 * "expires" or needs a background sweep.
 */
async function sweepMissingPunchPhotos() {
  const candidates = await pool.query(
    `SELECT p.id, p.emp_id, p.task_id, p.punch_time
     FROM punches p
     WHERE p.task_id IS NOT NULL
       AND p.photo_path IS NULL
       AND p.punch_time <= now() - ($1 || ' hours')::interval
       AND EXISTS (SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time < p.punch_time)`,
    [OUT_PHOTO_WINDOW_HOURS]
  );

  let raised = 0;
  for (const punch of candidates.rows) {
    const existing = await pool.query(
      `SELECT id FROM exceptions
       WHERE type = 'missing_punch_photo' AND ref_table = 'punches' AND ref_id = $1 AND status = 'open'`,
      [punch.id]
    );
    if (existing.rows.length > 0) continue;

    await pool.query(
      `INSERT INTO exceptions (type, emp_id, ref_table, ref_id, details, status)
       VALUES ('missing_punch_photo', $1, 'punches', $2, $3, 'open')`,
      [
        punch.emp_id,
        punch.id,
        `Employee ${punch.emp_id}'s out-photo for task ${punch.task_id} (closed ${punch.punch_time.toISOString()}) was never uploaded within the ${OUT_PHOTO_WINDOW_HOURS}h window.`,
      ]
    );
    raised++;
  }

  return { checked: candidates.rows.length, raised };
}

module.exports = { sweepMissingPunchPhotos };
