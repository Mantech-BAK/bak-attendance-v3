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

    const existing = await pool.query(
      'SELECT id FROM biometric_templates WHERE emp_id = $1',
      [emp_id]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE biometric_templates
         SET face_template = $1, registered_by = $2, registered_at = now()
         WHERE emp_id = $3
         RETURNING id, emp_id, registered_by, registered_at`,
        [faceTemplate, registered_by.trim(), emp_id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO biometric_templates (emp_id, face_template, registered_by, registered_at)
         VALUES ($1, $2, $3, now())
         RETURNING id, emp_id, registered_by, registered_at`,
        [emp_id, faceTemplate, registered_by.trim()]
      );
    }

    res.status(existing.rows.length > 0 ? 200 : 201).json(result.rows[0]);
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
