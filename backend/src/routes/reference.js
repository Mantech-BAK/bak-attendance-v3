const express = require('express');
const pool = require('../db');

const router = express.Router();

// Plain reference-data lookups backing the Employees edit form's Department/
// Designation/Division/Religion dropdowns (2026-09-23) — same shape/openness
// as GET /api/projects (no backoffice auth: these are just code+name lookup
// lists, nothing sensitive). Departments has no real primary key of its own
// (company_dept_id repeats across rows — see departments table comment
// history); employees."EmpDeptId" actually stores department_name directly
// (confirmed: every non-null EmpDeptId matches a departments.department_name
// exactly), so department_name IS the value this form reads/writes, not
// company_dept_id.
router.get('/departments', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT department_name, company_dept_id, default_project_code
       FROM departments
       ORDER BY department_name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/designations', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT designation_code, designation_name FROM designations ORDER BY designation_name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/divisions', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT division_code, division_name FROM divisions ORDER BY division_name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/religions', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT religion_code, religion_name FROM religions ORDER BY religion_name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
