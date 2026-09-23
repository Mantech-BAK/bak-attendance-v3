const express = require('express');
const pool = require('../db');
const { reverseGeocode } = require('../services/reverseGeocode');
const {
  getOpenPunchForToday,
  getOpenPunchForDate,
  dateKey,
  getBahrainDayBounds,
  punchKey,
  syncTaskSinglePunchException,
  resolveSinglePunchException,
} = require('../services/attendance');
const {
  PunchValidationError,
  resolvePunchTarget,
  checkOpenConflict,
  checkTaskPunchCap,
  checkOutdoorBanWindow,
  checkCrossKeyTimestampClash,
  checkNearDuplicate,
} = require('../services/punchValidation');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');
const { resolveBackofficeEmpId } = requireBackofficeAuth;
const { verifyFaceForEmployee } = require('../services/faceMatch');
const ExcelJS = require('exceljs');
const multer = require('multer');
const {
  uploadPunchPhoto,
  getSignedUrls,
} = require('../services/punchPhotoStorage');

const router = express.Router();

const PUNCH_SELECT_RETURNING = `id, emp_id, project_code, task_id, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, resolved_address, out_remark,
                 photo_path, photo_uploaded_at, created_at, extra_ot_minutes, extra_ot_granted_by, extra_ot_granted_at`;

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter(req, file, cb) {
    if (!PHOTO_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Unsupported file type. Upload a JPEG, PNG, or HEIC photo.'));
      return;
    }
    cb(null, true);
  },
});

// Client-side hint for the mobile app's task/project picker — which task
// (or, for the department-default fallback, which project) is currently
// open for this employee today. Not itself the enforcement point; POST /
// re-checks this same thing server-side regardless of what the client
// believes.
router.get('/today-status', async (req, res, next) => {
  try {
    const { emp_id } = req.query;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const open = await getOpenPunchForToday(emp_id);
    res.json({ open_task_id: open?.task_id ?? null, open_project_code: open?.project_code ?? null });
  } catch (err) {
    next(err);
  }
});

// Backoffice-only (full punch list, any employee) — mobile only ever reads
// its own scoped views (today-status, pending, history below).
router.get('/', requireBackofficeAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, g.designation_name AS employee_designation,
              p.project_code, pr.project_name, p.task_id, t.display_id AS task_display_id, t.description AS task_description,
              p.punch_time, p.lat, p.lng, p.entry_method,
              p.entered_by, p.approval_status, p.approved_by, p.approved_at, p.rejection_reason,
              p.resolved_address, p.out_remark, p.photo_path, p.photo_uploaded_at, p.created_at,
              (p.task_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time < p.punch_time
               )) AS is_in_punch
       FROM punches p
       LEFT JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       LEFT JOIN tasks t ON t.id = p.task_id
       ORDER BY p.punch_time ASC`
    );

    // Batched signed-URL generation (2026-09-14) — one round trip for every
    // photographed punch in the list, not one per row. Bucket is private,
    // so the list response never carries a bare storage path the frontend
    // could construct a URL from itself.
    const photoPaths = result.rows.filter((r) => r.photo_path).map((r) => r.photo_path);
    const signedUrls = await getSignedUrls(photoPaths);
    const rows = result.rows.map((r) => ({
      ...r,
      photo_url: r.photo_path ? (signedUrls.get(r.photo_path) ?? null) : null,
    }));

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Punch export as a downloadable .xlsx. With ?date=YYYY-MM-DD it's scoped to
// punches on that Asia/Riyadh business day (Reports page); with no date at
// all it exports every punch (Punches page's one-click export). Times are
// written in Asia/Riyadh local time, matching how the rest of the app
// reads a day. Must be declared before any parameterised GET route.
router.get('/export', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (date && !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const params = [];
    let where = '';
    if (date) {
      const { start, end } = getBahrainDayBounds(date);
      params.push(start, end);
      where = 'WHERE p.punch_time >= $1 AND p.punch_time < $2';
    }

    const result = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code, pr.project_name,
              t.display_id AS task_display_id, t.description AS task_description,
              to_char((p.punch_time AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI:SS') AS punch_time_local,
              p.entry_method, p.approval_status, p.rejection_reason, p.out_remark, p.resolved_address
       FROM punches p
       LEFT JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       LEFT JOIN tasks t ON t.id = p.task_id
       ${where}
       ORDER BY p.punch_time ASC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Punches');
    sheet.columns = [
      { header: 'Employee ID', key: 'emp_id', width: 12 },
      { header: 'Employee', key: 'employee_name', width: 24 },
      { header: 'Project', key: 'project_name', width: 26 },
      { header: 'Task ID', key: 'task_display_id', width: 20 },
      { header: 'Task', key: 'task_description', width: 36 },
      { header: 'Punch Time (Asia/Riyadh)', key: 'punch_time_local', width: 24 },
      { header: 'Entry Method', key: 'entry_method', width: 16 },
      { header: 'Approval', key: 'approval_status', width: 12 },
      { header: 'Rejection Reason', key: 'rejection_reason', width: 28 },
      { header: 'Out Remark', key: 'out_remark', width: 30 },
      { header: 'Address', key: 'resolved_address', width: 40 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of result.rows) sheet.addRow(row);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="punches-${date || 'all'}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// supervisor_emp_id is optional here, same shape as ot-approvals' /pending
// below: given, scoped to that supervisor's own team (mobile Review
// Attendance usage); omitted, requires a valid backoffice session and
// returns every pending punch company-wide (backoffice Approvals page —
// item 3 — an admin isn't literally anyone's reporting manager, so it can't
// use the manager-scoped path at all).
router.get('/pending', async (req, res, next) => {
  try {
    const { supervisor_emp_id } = req.query;
    let scopeEmpId = null;

    if (supervisor_emp_id) {
      const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
      if (supervisorResult.rows.length === 0) {
        return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
      }
      scopeEmpId = supervisor_emp_id;
    } else if (!(await resolveBackofficeEmpId(req))) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const pendingResult = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code, pr.project_name, p.task_id, t.display_id AS task_display_id,
              p.punch_time, p.lat, p.lng, p.entry_method, p.entered_by,
              (p.task_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time < p.punch_time
               )) AS is_in_punch
       FROM punches p
       JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       LEFT JOIN tasks t ON t.id = p.task_id
       WHERE p.approval_status = 'pending' ${scopeEmpId ? 'AND e."EmpReportMgrId" = $1' : ''}
       ORDER BY p.punch_time ASC`,
      scopeEmpId ? [scopeEmpId] : []
    );

    res.json(pendingResult.rows);
  } catch (err) {
    next(err);
  }
});

// Read-only punch history for this employee — every punch (any approval
// status) for themselves, plus their direct reports' if they're a
// supervisor, most recent first. No approve/reject action lives here;
// that's still /pending above. Capped at 200 rows so a long-tenured team's
// history doesn't return unbounded data. A regular employee (no direct
// reports) naturally gets only their own punches back from the same query —
// this one endpoint backs both the supervisor's combined Punch History tab
// and the plain-employee Punch History tab; the client tells rows apart via
// emp_id === the emp_id it queried with.
router.get('/history', async (req, res, next) => {
  try {
    const { emp_id } = req.query;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const historyResult = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, p.project_code, pr.project_name, p.task_id, t.display_id AS task_display_id,
              p.punch_time, p.entry_method, p.entered_by, p.approval_status, p.rejection_reason
       FROM punches p
       JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       LEFT JOIN tasks t ON t.id = p.task_id
       WHERE e."EmpReportMgrId" = $1 OR p.emp_id = $1
       ORDER BY p.punch_time DESC
       LIMIT 200`,
      [emp_id]
    );

    res.json(historyResult.rows);
  } catch (err) {
    next(err);
  }
});

// Single full-shape punch, backoffice-only — the Approvals page's Edit
// action (2026-09-23) needs the same fields AddPunchModal already relies on
// for the Punches page's Edit Punch (task_description, resolved_address,
// out_remark, photo, etc.), which GET /pending above deliberately doesn't
// carry (it's also polled by mobile's own Review Attendance tab, which
// never needed those fields). Declared after every literal-path GET above
// so none of them get swallowed by this :id pattern.
router.get('/:id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT p.id, p.emp_id, e."EmpName" AS employee_name, g.designation_name AS employee_designation,
              p.project_code, pr.project_name, p.task_id, t.display_id AS task_display_id, t.description AS task_description,
              p.punch_time, p.lat, p.lng, p.entry_method,
              p.entered_by, p.approval_status, p.approved_by, p.approved_at, p.rejection_reason,
              p.resolved_address, p.out_remark, p.photo_path, p.photo_uploaded_at, p.created_at,
              (p.task_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time < p.punch_time
               )) AS is_in_punch
       FROM punches p
       LEFT JOIN employees e ON e."EmpId" = p.emp_id
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN projects pr ON pr.project_code = p.project_code
       LEFT JOIN tasks t ON t.id = p.task_id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `punch ${id} not found` });
    }

    const row = result.rows[0];
    const signedUrls = row.photo_path ? await getSignedUrls([row.photo_path]) : new Map();
    res.json({ ...row, photo_url: row.photo_path ? (signedUrls.get(row.photo_path) ?? null) : null });
  } catch (err) {
    next(err);
  }
});

// bypassManagerCheck is only ever true for an authenticated backoffice
// session (item 3) — an admin isn't literally anyone's reporting manager,
// so the normal EmpReportMgrId match can never pass for them, the same way
// GET /pending above treats "no supervisor_emp_id + valid backoffice
// session" as its company-wide path. Shared by approve/reject below AND
// PUT /:id (2026-09-14) — the same "pending only" gate that already
// protected approve/reject is exactly the lock-once-approved rule editing
// needed too, so it's reused rather than re-implemented.
async function loadPunchForApproval(punchId, actingEmpId, { bypassManagerCheck } = {}) {
  const punchResult = await pool.query(
    `SELECT p.id, p.emp_id, p.task_id, p.punch_time, p.approval_status, e."EmpReportMgrId" AS reporting_manager_emp_id,
            (p.task_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM punches p2 WHERE p2.task_id = p.task_id AND p2.punch_time < p.punch_time
             )) AS is_in_punch
     FROM punches p
     JOIN employees e ON e."EmpId" = p.emp_id
     WHERE p.id = $1`,
    [punchId]
  );

  if (punchResult.rows.length === 0) {
    return { error: { status: 404, message: `punch ${punchId} not found` } };
  }

  const punch = punchResult.rows[0];

  if (!bypassManagerCheck && punch.reporting_manager_emp_id !== actingEmpId) {
    return { error: { status: 403, message: `${actingEmpId} is not the reporting manager for this punch` } };
  }

  if (punch.approval_status !== 'pending') {
    return { error: { status: 409, message: `punch ${punchId} has already been ${punch.approval_status}` } };
  }

  return { punch };
}

// Manual extra OT cap (2026-09-14) — a sanity ceiling on the raw number
// entered, purely to catch a fat-finger mistake (e.g. hours typed into a
// minutes field); it is NOT the same concept as max_ot_minutes, which caps
// the automatically-calculated figure. A deliberate manual grant is allowed
// to exceed that automatic cap entirely — see checkExtraOtMinutes below.
const MAX_EXTRA_OT_MINUTES = 720; // 12 hours

function parseExtraOtMinutes(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, minutes: null };
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_EXTRA_OT_MINUTES) {
    return { ok: false };
  }
  return { ok: true, minutes };
}

router.patch('/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { supervisor_emp_id, extra_ot_minutes } = req.body;
    const backofficeEmpId = await resolveBackofficeEmpId(req);
    const actingEmpId = backofficeEmpId || supervisor_emp_id;

    if (!actingEmpId) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }
    if (!backofficeEmpId) {
      const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
      if (supervisorResult.rows.length === 0) {
        return res.status(400).json({ error: `supervisor_emp_id ${supervisor_emp_id} not found` });
      }
    }

    const { punch, error } = await loadPunchForApproval(id, actingEmpId, { bypassManagerCheck: !!backofficeEmpId });
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const parsedExtraOt = parseExtraOtMinutes(extra_ot_minutes);
    if (!parsedExtraOt.ok) {
      return res.status(400).json({ error: `extra_ot_minutes must be a whole number of minutes between 1 and ${MAX_EXTRA_OT_MINUTES}` });
    }
    // Extra OT is only ever granted alongside approving a session's closing
    // (OUT) punch — an opening punch or a punch with no real task has no
    // completed session yet for the extra hours to attach to.
    if (parsedExtraOt.minutes !== null && punch.is_in_punch !== false) {
      return res.status(400).json({ error: 'extra_ot_minutes can only be granted when approving a closing (OUT) punch' });
    }

    const result = await pool.query(
      `UPDATE punches
       SET approval_status = 'approved', approved_by = $1, approved_at = now(),
           extra_ot_minutes = COALESCE($3, extra_ot_minutes),
           extra_ot_granted_by = CASE WHEN $3 IS NOT NULL THEN $1 ELSE extra_ot_granted_by END,
           extra_ot_granted_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE extra_ot_granted_at END
       WHERE id = $2
       RETURNING ${PUNCH_SELECT_RETURNING}, rejection_reason`,
      [actingEmpId, punch.id, parsedExtraOt.minutes]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { supervisor_emp_id, reason } = req.body;
    const backofficeEmpId = await resolveBackofficeEmpId(req);
    const actingEmpId = backofficeEmpId || supervisor_emp_id;

    if (!actingEmpId) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }
    if (!backofficeEmpId) {
      const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
      if (supervisorResult.rows.length === 0) {
        return res.status(400).json({ error: `supervisor_emp_id ${supervisor_emp_id} not found` });
      }
    }

    const { punch, error } = await loadPunchForApproval(id, actingEmpId, { bypassManagerCheck: !!backofficeEmpId });
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE punches
       SET approval_status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = now()
       WHERE id = $3
       RETURNING ${PUNCH_SELECT_RETURNING}, rejection_reason`,
      [String(reason).trim(), actingEmpId, punch.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { emp_id, task_id, project_code, lat, lng, entered_by, device_ref, out_remark, revalidation_face_embedding, revalidation_login_code } = req.body;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    // Location is now REQUIRED for every real-device punch through this
    // route (mobile self-punch and supervisor-on-behalf, both driven by the
    // mobile app's own GPS) — reversed from the earlier best-effort/
    // never-block design (2026-08-30 decision). A backoffice admin adding a
    // punch on someone's behalf never has real device GPS behind it at
    // all, so that flow stays on the separate /admin-correction route
    // below, untouched by this requirement.
    const hasLat = lat !== null && lat !== undefined;
    const hasLng = lng !== null && lng !== undefined;
    if (!hasLat || !hasLng) {
      return res.status(400).json({ error: 'Location is required to punch. Please enable location services and try again.' });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    const enteredBy = entered_by || emp_id;
    const isSelfPunch = enteredBy === emp_id;

    const employeeResult = await pool.query(
      'SELECT "EmpId" AS emp_id, "EmpReportMgrId" AS reporting_manager_emp_id, login_code, is_supervisor FROM employees WHERE "EmpId" = $1',
      [emp_id]
    );
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }
    const targetEmployee = employeeResult.rows[0];

    // Every self-punch — an employee OR a supervisor punching their OWN
    // tasks — requires fresh proof of identity immediately before THIS
    // specific punch (item 2, 2026-09-10). Re-validated every single time,
    // never cached across punches even moments apart, and enforced HERE
    // (not just via a separate pre-check the client could skip) so it can't
    // be bypassed by calling this endpoint directly. Deliberately does NOT
    // apply to the supervisor "Scan Team Member" on-behalf path
    // (enteredBy !== emp_id) — that flow's one initial scan, which
    // identifies WHO is being punched for, is unchanged by design.
    if (isSelfPunch) {
      let revalidated = false;

      if (Array.isArray(revalidation_face_embedding)) {
        revalidated = await verifyFaceForEmployee(emp_id, revalidation_face_embedding);
      } else if (typeof revalidation_login_code === 'string') {
        revalidated = targetEmployee.login_code === revalidation_login_code.trim().toUpperCase();
      }

      if (!revalidated) {
        return res.status(401).json({ error: 'Please confirm your identity again before punching.' });
      }
    }

    // Resolves to a specific task (project auto-filled/locked from it) when
    // task_id is given, else the bare project_code (department-default
    // fallback, unchanged from before task-tracking existed).
    const target = await resolvePunchTarget({ emp_id, task_id, project_code });

    // A task already at its 2-punch cap (Completed) can never be punched
    // again, even a genuine third attempt from the employee's own device.
    await checkTaskPunchCap({ task_id: target.task_id });

    let isClosingPunch = false;
    if (target.project_code) {
      // Only one task (or, for the fallback, one project) can be genuinely
      // "in progress" at a time — globally, across every project — punching
      // something DIFFERENT while one is still open (odd punch count today)
      // is rejected; punching that same open thing again (to close it) is
      // always allowed.
      await checkOpenConflict({
        emp_id,
        task_id: target.task_id,
        project_code: target.project_code,
        date: dateKey(new Date()),
      });

      // Re-derives the same "is this punch closing the currently-open
      // task/project" fact checkOpenConflict above already used internally
      // (it only throws or returns, doesn't expose it) — needed here to
      // gate out_remark. A closing punch is always the SAME key as
      // whatever's open (checkOpenConflict already rejected anything else).
      const openBeforeThisPunch = await getOpenPunchForDate(emp_id, dateKey(new Date()));
      isClosingPunch =
        !!openBeforeThisPunch &&
        punchKey(openBeforeThisPunch.task_id, openBeforeThisPunch.project_code) ===
          punchKey(target.task_id, target.project_code);
    }

    // Mandatory closing remark (2026-09-14) — the employee's (or, via Scan
    // Team Member, the supervisor's) note on what was done, required on the
    // OUT punch specifically. Rejected outright if sent on an opening punch
    // — should never happen from the app's own UI, so a stray value there
    // signals a bug worth surfacing, not silently dropping.
    const trimmedOutRemark = typeof out_remark === 'string' ? out_remark.trim() : '';
    if (isClosingPunch && !trimmedOutRemark) {
      return res.status(400).json({ error: 'A remark is required to punch out.' });
    }
    if (isClosingPunch && trimmedOutRemark.length > 500) {
      return res.status(400).json({ error: 'Remark must be 500 characters or fewer.' });
    }
    if (!isClosingPunch && trimmedOutRemark) {
      return res.status(400).json({ error: 'out_remark is only valid on the closing punch.' });
    }

    // Task photos are optional (reversed 2026-09-16, real physical-device
    // testing — previously mandatory here as of 2026-09-14). Punching in
    // and out never blocks on a missing photo anymore; whether a photo can
    // still be ADDED after the fact is instead enforced at upload time
    // (POST /:id/photo below), scoped to exactly the two cases product
    // called out: not after the task's own out-punch already happened
    // (in-photo), not after a different task has since been punched into
    // (out-photo). A photo that was simply never added raises no exception
    // at all (2026-09-23) — fully optional means fully optional, not
    // "optional but still flagged."

    // A supervisor's own punch auto-approves exactly like one they enter on
    // a direct report's behalf — this branch was missing until a real
    // supervisor's self-punch was found stuck on 'pending' despite
    // is_supervisor=true (2026-09-13): the on-behalf branch below checked
    // entered_by's is_supervisor, but a self-punch (entered_by === emp_id)
    // never reached that branch at all, so it always fell through to the
    // 'pending' default regardless of the flag.
    let entryMethod = 'self';
    let approvalStatus = targetEmployee.is_supervisor ? 'approved' : 'pending';

    if (enteredBy !== emp_id) {
      entryMethod = 'supervisor';

      const enteredByResult = await pool.query(
        `SELECT "EmpId" AS emp_id, is_supervisor FROM employees WHERE "EmpId" = $1`,
        [enteredBy]
      );
      if (enteredByResult.rows.length === 0) {
        return res.status(400).json({ error: `entered_by ${enteredBy} not found` });
      }

      // A supervisor may only punch on behalf of their own direct reports.
      if (targetEmployee.reporting_manager_emp_id !== enteredBy) {
        return res.status(403).json({ error: `${emp_id} does not report to ${enteredBy}` });
      }

      // Auto-approval is gated on the is_supervisor flag, not on "is a
      // reporting manager" generally. A reporting manager who isn't flagged
      // is_supervisor is a valid entered_by and passes the check above, but
      // their entries still land as 'pending' and surface in their own
      // GET /pending list for review.
      //
      // CONFIRMED INTENDED (2026-07-28) — not an oversight. Do not widen this
      // to "any reporting manager" without an explicit product decision to
      // do so; narrowing who gets auto-approval was a deliberate choice.
      // (Originally gated on designation_name === 'Supervisor' — moved to
      // this dedicated flag since real designations are things like
      // "Operations Manager", never literally "Supervisor".)
      approvalStatus = enteredByResult.rows[0].is_supervisor ? 'approved' : 'pending';
    }

    // punch_time is always the server's clock at receipt — never trust a
    // client-supplied timestamp, since shared devices with skewed clocks
    // would corrupt the ordering that attendance calculation depends on.
    const punchTime = new Date();

    // Summer Ban 12pm-4pm block (2026-09-14, rule 4) — no-ops for an Indoor
    // task, a non-Summer-Ban date, or the department-default fallback.
    await checkOutdoorBanWindow({ task_id: target.task_id, punchTime });

    // Real reverse geocoding via LocationIQ, resolved synchronously right
    // here. Never blocks or fails the punch — reverseGeocode() resolves to
    // null on any timeout/error rather than throwing.
    const resolvedAddress = await reverseGeocode(lat, lng);

    const result = await pool.query(
      `INSERT INTO punches
         (emp_id, project_code, task_id, punch_time, lat, lng, device_ref, entered_by, entry_method, approval_status, resolved_address, out_remark)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${PUNCH_SELECT_RETURNING}`,
      [emp_id, target.project_code, target.task_id, punchTime, lat ?? null, lng ?? null, device_ref || null, enteredBy, entryMethod, approvalStatus, resolvedAddress, isClosingPunch ? trimmedOutRemark : null]
    );

    if (target.task_id) {
      await syncTaskSinglePunchException(target.task_id);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof PunchValidationError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    next(err);
  }
});

/**
 * Uploads the in-photo or out-photo for a real-task punch (2026-09-14) —
 * always a separate action from recording the punch itself (item 6 of the
 * spec): the punch's own punch_time is never touched here, only
 * photo_path/photo_uploaded_at. role ('in'/'out') is derived server-side
 * from whether this punch is chronologically the first or second for its
 * task, never trusted from the client. Rejects a second upload for the
 * same punch outright (409) — this is how "exactly 2 photos per task, one
 * per punch" is enforced, since each punch row can only ever hold one.
 *
 * emp_id in the body authorizes the upload the same way entered_by does at
 * punch-creation time: either the punch's own employee (self) or whichever
 * supervisor originally entered it on their behalf (Scan Team Member) — no
 * separate re-validation beyond that, since uploading a photo isn't itself
 * a new identity claim the way punching is.
 */
router.post('/:id/photo', uploadPhoto.single('photo'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { emp_id } = req.body;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'photo file is required' });
    }

    const punchResult = await pool.query(
      'SELECT id, emp_id, entered_by, task_id, photo_path, punch_time FROM punches WHERE id = $1',
      [id]
    );
    if (punchResult.rows.length === 0) {
      return res.status(404).json({ error: `punch ${id} not found` });
    }
    const punch = punchResult.rows[0];

    if (emp_id !== punch.emp_id && emp_id !== punch.entered_by) {
      return res.status(403).json({ error: `${emp_id} is not authorized to upload a photo for this punch` });
    }
    if (!punch.task_id) {
      return res.status(400).json({ error: 'Photos are only required/accepted for real-task punches, not the department-default fallback.' });
    }
    if (punch.photo_path) {
      return res.status(409).json({ error: 'A photo has already been uploaded for this punch.' });
    }

    const priorCountResult = await pool.query(
      'SELECT count(*)::int AS cnt FROM punches WHERE task_id = $1 AND punch_time < $2',
      [punch.task_id, punch.punch_time]
    );
    const role = priorCountResult.rows[0].cnt === 0 ? 'in' : 'out';

    // Photos are optional at punch time (2026-09-16), but a photo can still
    // only be added within the same window it always could — these are the
    // two cases product called out explicitly, not a general time cutoff:
    // an in-photo can't be added once the task's own out-punch already
    // happened, and an out-photo can't be added once a different task has
    // since been punched into.
    if (role === 'in') {
      const outPunchExistsResult = await pool.query(
        `SELECT id FROM punches WHERE task_id = $1 AND approval_status <> 'rejected' AND punch_time > $2 LIMIT 1`,
        [punch.task_id, punch.punch_time]
      );
      if (outPunchExistsResult.rows.length > 0) {
        return res.status(409).json({ error: 'This task has already been closed — an in-photo can no longer be added.' });
      }
    } else {
      const laterDifferentTaskResult = await pool.query(
        `SELECT id FROM punches
         WHERE emp_id = $1 AND approval_status <> 'rejected' AND task_id IS NOT NULL AND task_id <> $2
           AND punch_time > $3
         LIMIT 1`,
        [punch.emp_id, punch.task_id, punch.punch_time]
      );
      if (laterDifferentTaskResult.rows.length > 0) {
        return res.status(409).json({ error: 'A different task has already been started — this out-photo can no longer be added.' });
      }
    }

    const photoPath = await uploadPunchPhoto(punch.id, role, req.file.buffer, req.file.mimetype);

    const updateResult = await pool.query(
      `UPDATE punches SET photo_path = $1, photo_uploaded_at = now() WHERE id = $2 RETURNING ${PUNCH_SELECT_RETURNING}`,
      [photoPath, punch.id]
    );

    res.status(201).json(updateResult.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Admin-only manual punch correction — for backfilling a punch an employee
 * never actually recorded (most commonly to resolve a single_punch_only
 * exception), or any other missing entry. Deliberately a separate endpoint
 * from POST / rather than a variant of it: this accepts an explicit
 * admin-supplied punch_time instead of trusting the server clock, skips the
 * "already has an open task today" 409 for TODAY specifically the way
 * POST / enforces it — this endpoint scopes that check to whatever date is
 * actually being corrected instead — and is unconditionally auto-approved —
 * an admin directly correcting attendance data is a trusted, deliberate
 * action, not something that then needs someone else's review.
 *
 * entered_by is never taken from the request body — it's always the
 * authenticated admin from the session token (req.backofficeEmpId), same
 * as every other backoffice-authed write. Passing it explicitly would let
 * one logged-in admin attribute a correction to someone else.
 */
router.post('/admin-correction', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id, task_id, project_code, punch_time, force, out_remark } = req.body;
    const enteredBy = req.backofficeEmpId;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!task_id && !project_code) {
      return res.status(400).json({ error: 'task_id or project_code is required' });
    }
    if (!punch_time) {
      return res.status(400).json({ error: 'punch_time is required' });
    }
    const parsedPunchTime = new Date(punch_time);
    if (Number.isNaN(parsedPunchTime.getTime())) {
      return res.status(400).json({ error: 'punch_time is not a valid timestamp' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const target = await resolvePunchTarget({ emp_id, task_id, project_code });
    const punchDate = dateKey(parsedPunchTime);

    await checkTaskPunchCap({ task_id: target.task_id });
    await checkOpenConflict({ emp_id, task_id: target.task_id, project_code: target.project_code, date: punchDate });
    await checkCrossKeyTimestampClash({ emp_id, task_id: target.task_id, project_code: target.project_code, punchTime: parsedPunchTime });
    await checkNearDuplicate({ emp_id, task_id: target.task_id, project_code: target.project_code, punchTime: parsedPunchTime, force });
    // Summer Ban block applies to admin corrections too (2026-09-14) — the
    // rule is stated as absolute ("no punch... can be recorded"), not just
    // a live-capture constraint; an admin can't backdate around it either.
    await checkOutdoorBanWindow({ task_id: target.task_id, punchTime: parsedPunchTime });

    // Same mandatory-on-close / forbidden-on-open rule as the mobile route
    // (2026-09-14), scoped to whatever date is actually being corrected
    // (punchDate, an admin-supplied timestamp) rather than "today" — this
    // route already scopes checkOpenConflict the same way, above.
    let isClosingPunch = false;
    if (target.project_code) {
      const openBeforeThisPunch = await getOpenPunchForDate(emp_id, punchDate);
      isClosingPunch =
        !!openBeforeThisPunch &&
        punchKey(openBeforeThisPunch.task_id, openBeforeThisPunch.project_code) ===
          punchKey(target.task_id, target.project_code);
    }
    const trimmedOutRemark = typeof out_remark === 'string' ? out_remark.trim() : '';
    if (isClosingPunch && !trimmedOutRemark) {
      return res.status(400).json({ error: 'A remark is required to punch out.' });
    }
    if (isClosingPunch && trimmedOutRemark.length > 500) {
      return res.status(400).json({ error: 'Remark must be 500 characters or fewer.' });
    }
    if (!isClosingPunch && trimmedOutRemark) {
      return res.status(400).json({ error: 'out_remark is only valid on the closing punch.' });
    }

    const result = await pool.query(
      `INSERT INTO punches
         (emp_id, project_code, task_id, punch_time, lat, lng, entered_by, entry_method, approval_status, approved_by, approved_at, out_remark)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5, 'admin_correction', 'approved', $5, now(), $6)
       RETURNING ${PUNCH_SELECT_RETURNING}`,
      [emp_id, target.project_code, target.task_id, parsedPunchTime, enteredBy, isClosingPunch ? trimmedOutRemark : null]
    );

    if (target.task_id) {
      await syncTaskSinglePunchException(target.task_id);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof PunchValidationError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    next(err);
  }
});

/**
 * Punch edit — corrects an existing PENDING punch's task/project (and
 * nothing else). Dual-authorized exactly like PATCH /:id/approve above: a
 * backoffice admin, or (2026-09-14) a supervisor editing their own direct
 * report's punch before deciding whether to approve it, via
 * supervisor_emp_id. loadPunchForApproval enforces both who's allowed to
 * touch this punch AND that it's still 'pending' — once approved (or
 * rejected), this 409s for everyone, admin included, with no separate check
 * to bypass. That's the actual lock-once-approved rule; there is no other
 * gate on this route.
 *
 * punch_time is never editable here, full stop (2026-09-22) — not "locked
 * once approved," locked always, for admin and supervisor alike. The
 * factual moment someone punched is never alterable after the fact; what
 * the punch was FOR (project/task) can still be reasonably corrected before
 * approval, which is the entire remaining point of this route. A request
 * that includes a punch_time key at all is rejected outright (400) rather
 * than silently ignored, so a stale client still trying to send one fails
 * loudly instead of quietly no-opping. (A genuinely new backfilled punch —
 * POST /api/punches/admin-correction — is a different thing: it's
 * recording the first and only timestamp for an event that was never
 * electronically captured, not altering an already-recorded one, so it
 * legitimately still takes an explicit time.)
 *
 * Goes through the exact same validation as creating a punch
 * (resolvePunchTarget, checkOpenConflict, checkCrossKeyTimestampClash,
 * checkNearDuplicate), keyed off the punch's own real, immutable
 * punch_time (loaded from the row itself, never from the request) — with
 * the punch's own id excluded from every check so re-validating its
 * existing time against a new task/project doesn't spuriously conflict
 * with itself. emp_id is never editable here either — moving a punch to a
 * different employee isn't a "correction," it's a different punch; delete
 * and re-create instead.
 *
 * entry_method is only relabeled 'admin_correction' when a backoffice
 * admin is the one editing — a supervisor's edit leaves it as whatever it
 * already was (self/supervisor), since relabeling it 'admin_correction'
 * would misattribute it in the Punches list.
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { task_id, project_code, punch_time, force, supervisor_emp_id } = req.body;
    const backofficeEmpId = await resolveBackofficeEmpId(req);
    const actingEmpId = backofficeEmpId || supervisor_emp_id;

    if (punch_time !== undefined) {
      return res.status(400).json({ error: 'punch_time cannot be edited — the recorded punch time is permanent and never editable, by anyone, at any stage.' });
    }

    if (!actingEmpId) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }
    if (!backofficeEmpId) {
      const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
      if (supervisorResult.rows.length === 0) {
        return res.status(400).json({ error: `supervisor_emp_id ${supervisor_emp_id} not found` });
      }
    }

    const { punch, error } = await loadPunchForApproval(id, actingEmpId, { bypassManagerCheck: !!backofficeEmpId });
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }
    const empId = punch.emp_id;
    const oldTaskId = punch.task_id;
    const existingPunchTime = punch.punch_time;

    if (!task_id && !project_code) {
      return res.status(400).json({ error: 'task_id or project_code is required' });
    }

    const target = await resolvePunchTarget({ emp_id: empId, task_id, project_code });
    const punchDate = dateKey(existingPunchTime);
    const punchId = Number(id);

    await checkTaskPunchCap({ task_id: target.task_id, excludePunchId: punchId });
    await checkOpenConflict({ emp_id: empId, task_id: target.task_id, project_code: target.project_code, date: punchDate, excludePunchId: punchId });
    await checkCrossKeyTimestampClash({ emp_id: empId, task_id: target.task_id, project_code: target.project_code, punchTime: existingPunchTime, excludePunchId: punchId });
    await checkNearDuplicate({ emp_id: empId, task_id: target.task_id, project_code: target.project_code, punchTime: existingPunchTime, excludePunchId: punchId, force });
    // Summer Ban block applies to edits too (2026-09-14) — same absolute
    // rule as admin-correction above.
    await checkOutdoorBanWindow({ task_id: target.task_id, punchTime: existingPunchTime });

    const result = await pool.query(
      backofficeEmpId
        ? `UPDATE punches
           SET project_code = $1, task_id = $2, entry_method = 'admin_correction'
           WHERE id = $3
           RETURNING ${PUNCH_SELECT_RETURNING}`
        : `UPDATE punches
           SET project_code = $1, task_id = $2
           WHERE id = $3
           RETURNING ${PUNCH_SELECT_RETURNING}`,
      [target.project_code, target.task_id, punchId]
    );

    // Resolve first in case this punch's own id was the ref for an open
    // exception that no longer applies to it now (task/time changed) —
    // then re-evaluate both the task it left (if any, and different) and
    // whatever task it now belongs to, since either side's Pending/
    // Completed state may have just flipped.
    await resolveSinglePunchException(punchId);
    if (oldTaskId && oldTaskId !== target.task_id) {
      await syncTaskSinglePunchException(oldTaskId);
    }
    if (target.task_id) {
      await syncTaskSinglePunchException(target.task_id);
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof PunchValidationError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    next(err);
  }
});

// Admin-only punch delete — a real, permanent removal (not a soft
// approval_status change), so the frontend gates it behind an explicit
// confirmation dialog. No confirm-token requirement server-side (unlike
// Settings' reset-test-data) since this deletes exactly one identified row,
// not a whole table's worth of data.
router.delete('/:id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM punches WHERE id = $1 RETURNING id, task_id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `punch ${id} not found` });
    }
    const taskId = result.rows[0].task_id;

    // This punch no longer exists, so any open exception still referencing
    // its id no longer applies — resolve it, then re-evaluate whatever's
    // left on the task (a no-op if none, a fresh raise if exactly one
    // punch now remains).
    await resolveSinglePunchException(Number(id));
    if (taskId) {
      await syncTaskSinglePunchException(taskId);
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Handles Multer errors (bad mime type, file too large) with a clean 400
// instead of falling through to the default Express error page — same
// pattern as routes/tasks.js's bulk-upload handler.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
