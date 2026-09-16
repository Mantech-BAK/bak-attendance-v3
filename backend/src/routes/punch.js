const express = require('express');
const { getTodaysTasks } = require('../services/tasks');
const { verifyEmployeeCredentials, getEmployeeById } = require('../services/identify');
const { identifyByFace, verifyFaceForEmployee } = require('../services/faceMatch');
const { getEmergencyTimeAllowance, isWithinEmergencyWindow, utcHHMMToLocalHHMM, getAllSettings, parseSummerBanPeriods, isWithinSummerBan, localDateKey } = require('../services/settings');

const router = express.Router();

// Read-only, unauthenticated (same reasoning as everything else in this
// file — mobile has no session/JWT concept) — lets the mobile app show/hide
// its self-service "Create Task" entry point without a wasted round trip to
// POST /api/tasks just to discover the window is closed. is_open is
// computed here (server clock, UTC) rather than left for the client to
// derive from start/end + its own device clock, which could be wrong or in
// a different timezone — that part is unchanged. start/end are converted to
// Asia/Riyadh before being sent, though: an employee reading "opens
// 22:00–06:00" needs their own real local wall-clock hours, not the raw
// UTC storage value, same reasoning as the Settings UI's own conversion.
router.get('/emergency-window', async (req, res, next) => {
  try {
    const [{ start, end }, isOpen] = await Promise.all([
      getEmergencyTimeAllowance(),
      isWithinEmergencyWindow(),
    ]);
    res.json({ start: utcHHMMToLocalHHMM(start), end: utcHHMMToLocalHHMM(end), is_open: isOpen });
  } catch (err) {
    next(err);
  }
});

// Read-only, unauthenticated, same reasoning as /emergency-window above —
// lets task-creation UIs (mobile Create Team Task / Emergency Task) know
// whether to surface the Indoor/Outdoor question at all (2026-09-14): it's
// only asked while a Summer Ban period is declared AND active for today's
// real Asia/Riyadh calendar date, never otherwise. POST /api/tasks itself
// re-derives this same fact server-side regardless of what the client saw.
router.get('/summer-ban-status', async (req, res, next) => {
  try {
    const settingsMap = await getAllSettings();
    const periods = parseSummerBanPeriods(settingsMap);
    const active = isWithinSummerBan(localDateKey(new Date()), periods);
    res.json({ active });
  } catch (err) {
    next(err);
  }
});

/**
 * Typed { emp_id, login_code } identification — the fallback path,
 * always available alongside /identify-face below. employees.login_code is
 * a random 5-letter code (see ../services/loginCode, assigned to every new
 * employee on creation), viewable/regeneratable by an admin from the
 * backoffice Employees page.
 *
 * Credential lookup lives in services/identify.js, shared with the
 * backoffice login flow (routes/auth.js) — this route is otherwise
 * unchanged: no auth is required to call it, and it never sees the
 * backoffice's authorization rule.
 */
router.post('/identify', async (req, res, next) => {
  try {
    const { emp_id, login_code } = req.body || {};

    if (!emp_id || !login_code) {
      return res.status(400).json({ error: 'emp_id and login_code are required' });
    }

    const employee = await verifyEmployeeCredentials(emp_id, login_code);

    // Generic "invalid" message either way (unknown emp_id vs. wrong code) —
    // don't let this endpoint reveal whether an emp_id exists.
    if (!employee) {
      return res.status(401).json({ error: 'Invalid employee ID or code.' });
    }

    if (employee.status !== 'active') {
      return res.status(403).json({ error: `Employee ${employee.emp_id} is inactive and cannot punch.` });
    }

    const tasks = await getTodaysTasks(employee.emp_id);

    res.json({
      emp_id: employee.emp_id,
      name: employee.name,
      designation: employee.designation,
      is_supervisor: employee.is_supervisor,
      tasks,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Face-capture identification — 1:N open identification (confirmed
 * design): no emp_id is submitted at all. The mobile app computes a
 * 192-dim face embedding on-device (MobileFaceNet via
 * react-native-fast-tflite) from a single live capture and posts just the
 * embedding; faceMatch.identifyByFace searches every active,
 * face-registered employee's stored embeddings for the closest cosine-
 * similarity match at or above its threshold. Same generic-rejection
 * shape as /identify below (a non-match here just means "fall back to
 * Employee ID + code" — no distinction between "no face close enough" and
 * "matched employee happens to be inactive", since inactive employees are
 * excluded from the candidate pool entirely).
 */
router.post('/identify-face', async (req, res, next) => {
  try {
    const { embedding } = req.body || {};

    const empId = await identifyByFace(embedding);
    if (!empId) {
      return res.status(401).json({ error: 'Face not recognized.' });
    }

    const employee = await getEmployeeById(empId);
    if (!employee || employee.status !== 'active') {
      return res.status(401).json({ error: 'Face not recognized.' });
    }

    const tasks = await getTodaysTasks(employee.emp_id);

    res.json({
      emp_id: employee.emp_id,
      name: employee.name,
      designation: employee.designation,
      is_supervisor: employee.is_supervisor,
      tasks,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 1:1 re-validation — "is this still emp_id's face" — used immediately
 * before every self-punch (item 2, 2026-09-10), distinct from
 * /identify-face's open 1:N search above. Gives the mobile capture UI fast
 * pass/fail feedback with a clear retry loop; this alone does NOT record
 * anything or grant access to punch — POST /api/punches independently
 * re-verifies the same embedding against the same employee before
 * accepting the punch, so this check can't be bypassed by skipping this
 * route and calling the punch endpoint directly.
 */
router.post('/verify-face', async (req, res, next) => {
  try {
    const { emp_id, embedding } = req.body || {};
    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }

    const matched = await verifyFaceForEmployee(emp_id, embedding);
    if (!matched) {
      return res.status(401).json({ error: 'Face not recognized. Please try again.' });
    }

    res.json({ matched: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
