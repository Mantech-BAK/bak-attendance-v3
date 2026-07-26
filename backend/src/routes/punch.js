const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { matchFace } = require('../services/faceMatch');

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

router.post('/identify', upload.single('face'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'face image file is required (field name: "face")' });
    }

    const matchedEmpId = await matchFace(req.file.buffer);
    if (!matchedEmpId) {
      return res.status(404).json({ error: 'No matching employee found. Please try again or ask your supervisor for help.' });
    }

    const employeeResult = await pool.query(
      'SELECT emp_id, name, designation, status FROM employees WHERE emp_id = $1',
      [matchedEmpId]
    );
    const employee = employeeResult.rows[0];

    if (employee.status !== 'active') {
      return res.status(403).json({ error: `Employee ${employee.emp_id} is inactive and cannot punch.` });
    }

    const tasksResult = await pool.query(
      `SELECT id, project_code, priority, description, location, status
       FROM tasks
       WHERE emp_id = $1 AND task_date = CURRENT_DATE
       ORDER BY id`,
      [employee.emp_id]
    );

    const tasks = tasksResult.rows.map((task) => ({
      id: task.id,
      project_code: task.project_code,
      name: task.description || task.location || task.project_code,
      priority: task.priority,
      status: task.status,
    }));

    res.json({
      emp_id: employee.emp_id,
      name: employee.name,
      designation: employee.designation,
      tasks,
    });
  } catch (err) {
    next(err);
  }
});

// Handles Multer errors (bad mime type, file too large) with a clean 400.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.startsWith('Unsupported image type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
