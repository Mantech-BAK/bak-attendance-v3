const express = require('express');
const pool = require('../db');
const { generateUniqueLoginCode } = require('../services/loginCode');
const { isValidEmbedding, EMBEDDING_LENGTH } = require('../services/faceMatch');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

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
              e.login_code, e."EmpCreatedOn" AS created_at,
              e."EmpFaceId" IS NOT NULL AS has_face_registered
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
              e.login_code, e."EmpCreatedOn" AS created_at,
              e."EmpFaceId" IS NOT NULL AS has_face_registered
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
 * Self-service face registration — an employee registers their own face
 * after already identifying via the typed emp_id+login_code flow (the same
 * trust level as every other mobile self-service action in this app, e.g.
 * employee_self task creation: no backoffice auth, no session token,
 * reaching this screen state is the only "proof" mobile ever has). Rejects
 * if EmpFaceId is already set — re-registration requires an admin reset
 * (POST /:emp_id/face/reset below) first, enforced here server-side too,
 * not just via the mobile UI's has_face_registered gate.
 *
 * embeddings are 192-dim MobileFaceNet vectors computed on-device (see
 * services/faceMatch.js) from 3-4 guided-angle captures; stored as JSON
 * text in EmpFaceId (still a `text` column — no schema change), replacing
 * the old single-base64-image format this route used to write.
 */
router.post('/:emp_id/face-embeddings', async (req, res, next) => {
  try {
    const { emp_id } = req.params;
    const { embeddings } = req.body || {};

    if (!Array.isArray(embeddings) || embeddings.length === 0) {
      return res.status(400).json({ error: 'embeddings is required and must be a non-empty array' });
    }
    if (!embeddings.every(isValidEmbedding)) {
      return res.status(400).json({ error: `each embedding must be an array of ${EMBEDDING_LENGTH} numbers` });
    }

    const employee = await pool.query(
      'SELECT "EmpId" AS emp_id, "EmpStatus" AS status, "EmpFaceId" AS face_id FROM employees WHERE "EmpId" = $1',
      [emp_id]
    );
    if (employee.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }
    if (employee.rows[0].status !== 'active') {
      return res.status(403).json({ error: `employee ${emp_id} is inactive` });
    }
    if (employee.rows[0].face_id !== null) {
      return res.status(409).json({ error: 'Face already registered. Ask an admin to reset it first.' });
    }

    const result = await pool.query(
      `UPDATE employees
       SET "EmpFaceId" = $1, "EmpRegistredBy" = $2, "EmpRegisteredAt" = now()
       WHERE "EmpId" = $3
       RETURNING "EmpId" AS emp_id, "EmpRegistredBy" AS registered_by, "EmpRegisteredAt" AS registered_at`,
      [JSON.stringify({ v: 1, embeddings }), emp_id, emp_id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Admin-only: clear an employee's registered face data, letting them
// register again. Same shape as login-code regenerate below (confirm ->
// per-row action -> plain update), just nulling instead of rotating.
router.post('/:emp_id/face/reset', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { emp_id } = req.params;

    const existing = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const result = await pool.query(
      `UPDATE employees
       SET "EmpFaceId" = NULL, "EmpRegistredBy" = NULL, "EmpRegisteredAt" = NULL
       WHERE "EmpId" = $1
       RETURNING "EmpId" AS emp_id`,
      [emp_id]
    );

    res.json(result.rows[0]);
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

module.exports = router;
