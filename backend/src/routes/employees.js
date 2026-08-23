const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { generateUniqueLoginCode } = require('../services/loginCode');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Unsupported image type. Use JPEG, PNG, or WEBP.'));
      return;
    }
    cb(null, true);
  },
});

// company/designation are now FK-constrained into divisions/designations
// (schema-rename revision) — joined and aliased back to their original
// external names so this response shape is unchanged for every consumer.
// Backoffice-only (full roster) — mobile never lists every employee, only
// /direct-reports and /:emp_id below, which stay unauthenticated.
router.get('/', requireBackofficeAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, d.division_name AS company,
              e."EmpDeptId" AS department, g.designation_name AS designation,
              e."EmpReportMgrId" AS reporting_manager_emp_id, e."EmpStatus" AS status,
              CASE WHEN e."EmpOtStatus" THEN 'Y' ELSE 'N' END AS ot_eligible,
              e.login_code, e."EmpCreatedOn" AS created_at
       FROM employees e
       LEFT JOIN divisions d ON e."EmpDivision" = d.division_code
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       ORDER BY e."EmpName"`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/direct-reports', async (req, res, next) => {
  try {
    const { supervisor_emp_id } = req.query;

    if (!supervisor_emp_id) {
      return res.status(400).json({ error: 'supervisor_emp_id is required' });
    }

    const supervisorResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
    }

    const reportsResult = await pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, g.designation_name AS designation,
              e."EmpDeptId" AS department, e."EmpStatus" AS status
       FROM employees e
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       WHERE e."EmpReportMgrId" = $1
       ORDER BY e."EmpName"`,
      [supervisor_emp_id]
    );

    res.json(reportsResult.rows);
  } catch (err) {
    next(err);
  }
});

// Single-employee lookup — used by the mobile app's Profile tab (item 12)
// to show fuller detail (department, status, login_code) than the minimal
// identify() response returns. Declared after /direct-reports so that
// literal path isn't shadowed by this :emp_id param route.
router.get('/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const result = await pool.query(
      `SELECT e."EmpId" AS emp_id, e."EmpName" AS name, d.division_name AS company,
              e."EmpDeptId" AS department, g.designation_name AS designation,
              e."EmpReportMgrId" AS reporting_manager_emp_id, e."EmpStatus" AS status,
              CASE WHEN e."EmpOtStatus" THEN 'Y' ELSE 'N' END AS ot_eligible,
              e.login_code, e."EmpCreatedOn" AS created_at
       FROM employees e
       LEFT JOIN divisions d ON e."EmpDivision" = d.division_code
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       WHERE e."EmpId" = $1`,
      [emp_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Admin-only, onboarding-time face registration — not self-enrollment.
 * registered_by is always the authenticated admin (req.backofficeEmpId),
 * never a client-supplied value — same reasoning as admin-correction's
 * entered_by / ramzan's declared_by / tasks' created_by. Not currently
 * wired to any frontend (face-based identification was superseded by typed
 * emp_id+login_code — see routes/punch.js), but kept consistent with the
 * rest of the codebase's session-derived-identity convention rather than
 * left as a dormant gap that resurfaces if this ever gets a UI.
 */
router.post('/:emp_id/register-face', requireBackofficeAuth, upload.single('face'), async (req, res, next) => {
  try {
    const { emp_id } = req.params;
    const registeredBy = req.backofficeEmpId;

    if (!req.file) {
      return res.status(400).json({ error: 'face image file is required (field name: "face")' });
    }

    const employee = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employee.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const faceTemplate = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const result = await pool.query(
      `UPDATE employees
       SET "EmpFaceId" = $1, "EmpRegistredBy" = $2, "EmpRegisteredAt" = now()
       WHERE "EmpId" = $3
       RETURNING "EmpId" AS emp_id, "EmpRegistredBy" AS registered_by, "EmpRegisteredAt" AS registered_at`,
      [faceTemplate, registeredBy, emp_id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Admin-only: regenerate an employee's login_code (the temporary typed-code
// identification measure — see routes/punch.js). Testers need a way to
// recover/rotate a code, e.g. after it leaks or is forgotten. Backoffice-only.
router.post('/:emp_id/login-code/regenerate', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const existing = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const loginCode = await generateUniqueLoginCode();
    const result = await pool.query(
      'UPDATE employees SET login_code = $1 WHERE "EmpId" = $2 RETURNING "EmpId" AS emp_id, login_code',
      [loginCode, emp_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

const LOGIN_CODE_PATTERN = /^[A-Z]{5}$/;

/**
 * Full-record edit from the backoffice Employees page — name, status
 * (active/inactive), login code, OT eligibility, and reporting manager, plus
 * EmpId itself. EmpId is the primary key: renaming it is safe only because
 * of the 2026-08-23 migration adding ON UPDATE CASCADE to every FK that
 * references employees.EmpId (punches, tasks, ot_approvals,
 * confirmation_sheet_records) and adding one for the first time on
 * EmpReportMgrId (previously unconstrained) — a single UPDATE here is all
 * that's needed; Postgres propagates the rename everywhere automatically.
 *
 * Deliberately does NOT cover department/designation/division/religion —
 * those are FK-coded fields with no list-fetching endpoint anywhere in this
 * app yet (the Employees table only ever shows their already-joined display
 * names), so editing them here would need new reference-data endpoints this
 * change doesn't add. Scoped to the fields this form can actually validate.
 */
router.put('/:emp_id', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id } = req.params;
    const { new_emp_id, name, status, login_code, ot_eligible, reporting_manager_emp_id } = req.body;

    if (!new_emp_id || !String(new_emp_id).trim()) {
      return res.status(400).json({ error: 'new_emp_id is required' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }
    if (typeof ot_eligible !== 'boolean') {
      return res.status(400).json({ error: 'ot_eligible must be a boolean' });
    }

    const trimmedNewEmpId = String(new_emp_id).trim();
    const trimmedName = String(name).trim();
    const trimmedLoginCode = login_code ? String(login_code).trim().toUpperCase() : null;
    if (trimmedLoginCode && !LOGIN_CODE_PATTERN.test(trimmedLoginCode)) {
      return res.status(400).json({ error: 'login_code must be exactly 5 letters (A-Z)' });
    }
    const trimmedManagerId = reporting_manager_emp_id ? String(reporting_manager_emp_id).trim() : null;
    if (trimmedManagerId && trimmedManagerId === trimmedNewEmpId) {
      return res.status(400).json({ error: 'an employee cannot report to themselves' });
    }

    const existing = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    try {
      const result = await pool.query(
        `UPDATE employees
         SET "EmpId" = $1, "EmpName" = $2, "EmpStatus" = $3, login_code = $4,
             "EmpOtStatus" = $5, "EmpReportMgrId" = $6
         WHERE "EmpId" = $7
         RETURNING "EmpId" AS emp_id, "EmpName" AS name, "EmpStatus" AS status, login_code,
                   CASE WHEN "EmpOtStatus" THEN 'Y' ELSE 'N' END AS ot_eligible,
                   "EmpReportMgrId" AS reporting_manager_emp_id`,
        [trimmedNewEmpId, trimmedName, status, trimmedLoginCode, ot_eligible, trimmedManagerId, emp_id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        if (err.constraint === 'employees_pkey') {
          return res.status(409).json({ error: `employee ID ${trimmedNewEmpId} is already in use` });
        }
        if (err.constraint === 'employees_login_code_key') {
          return res.status(409).json({ error: `login code ${trimmedLoginCode} is already in use` });
        }
        return res.status(409).json({ error: 'that value is already in use by another employee' });
      }
      if (err.code === '23503') {
        return res.status(400).json({ error: `reporting_manager_emp_id ${trimmedManagerId} not found` });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Handles Multer errors (bad mime type, file too large) with a clean 400
// instead of falling through to the default Express error page.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.startsWith('Unsupported image type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
