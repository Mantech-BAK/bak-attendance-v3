const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { generateUniqueLoginCode } = require('../services/loginCode');

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
router.get('/', async (req, res, next) => {
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
 * The caller (admin portal) must identify who is performing the
 * registration via `registered_by`; there is no session/auth layer
 * yet to derive this automatically.
 */
router.post('/:emp_id/register-face', upload.single('face'), async (req, res, next) => {
  try {
    const { emp_id } = req.params;
    const { registered_by } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'face image file is required (field name: "face")' });
    }

    if (!registered_by || !registered_by.trim()) {
      return res.status(400).json({ error: 'registered_by is required' });
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
      [faceTemplate, registered_by.trim(), emp_id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Admin-only: regenerate an employee's login_code (the temporary typed-code
// identification measure — see routes/punch.js). Testers need a way to
// recover/rotate a code, e.g. after it leaks or is forgotten.
router.post('/:emp_id/login-code/regenerate', async (req, res, next) => {
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

// Handles Multer errors (bad mime type, file too large) with a clean 400
// instead of falling through to the default Express error page.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.startsWith('Unsupported image type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
