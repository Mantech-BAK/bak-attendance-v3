const express = require('express');
const multer = require('multer');
const pool = require('../db');

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

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT emp_id, name, company, department, designation, reporting_manager_emp_id, status, ot_eligible, created_at
       FROM employees
       ORDER BY name`
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

    const supervisorResult = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [supervisor_emp_id]);
    if (supervisorResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${supervisor_emp_id} not found` });
    }

    const reportsResult = await pool.query(
      `SELECT emp_id, name, designation, department, status
       FROM employees
       WHERE reporting_manager_emp_id = $1
       ORDER BY name`,
      [supervisor_emp_id]
    );

    res.json(reportsResult.rows);
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

    const employee = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [emp_id]);
    if (employee.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const faceTemplate = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const result = await pool.query(
      `UPDATE employees
       SET face_template = $1, registered_by = $2, registered_at = now()
       WHERE emp_id = $3
       RETURNING emp_id, registered_by, registered_at`,
      [faceTemplate, registered_by.trim(), emp_id]
    );

    res.status(200).json(result.rows[0]);
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
