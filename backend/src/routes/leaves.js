const express = require('express');
const multer = require('multer');
const pool = require('../db');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');
const { uploadLeavePhoto, getSignedUrls } = require('../services/punchPhotoStorage');

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEAVE_TYPES = ['Sick Leave', 'Annual Leave', 'Emergency Leave', 'Unpaid Leave', 'Compassionate Leave'];

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB, same cap as punch photos
  fileFilter(req, file, cb) {
    // A phone can hand over a perfectly good photo with no usable content
    // type (blank / application/octet-stream) — accept it when the filename
    // is clearly an image rather than failing the whole leave report over it.
    const looksLikeImage = /\.(jpe?g|png|heic|heif)$/i.test(file.originalname || '');
    const genericType = !file.mimetype || file.mimetype === 'application/octet-stream';
    if (!PHOTO_MIME_TYPES.includes(file.mimetype) && !(genericType && looksLikeImage)) {
      cb(new Error('Unsupported file type. Upload a JPEG, PNG, or HEIC photo.'));
      return;
    }
    cb(null, true);
  },
});

const LEAVE_SELECT = `l.id, l.emp_id, e."EmpName" AS employee_name, g.designation_name AS employee_designation,
       l.leave_date, l.leave_type, l.remarks, l.photo_path, l.photo_uploaded_at, l.reported_by, l.created_at
       FROM leave_reports l
       LEFT JOIN employees e ON l.emp_id = e."EmpId"
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code`;

// Mobile's Report Leave tab — no backoffice session (identical shape to
// POST /api/tasks: emp_id comes from the already-identified mobile user,
// never from a backoffice-authenticated admin here). The photo is optional
// — the form itself offers camera or gallery, but submitting with neither
// is still allowed, same "optional at submit time" spirit as punch photos
// pre-2026-09-16.
router.post('/', uploadPhoto.single('photo'), async (req, res, next) => {
  try {
    const { emp_id, leave_date, leave_type, remarks, reported_by } = req.body;

    if (!emp_id || !leave_date || !leave_type) {
      return res.status(400).json({ error: 'emp_id, leave_date, and leave_type are required' });
    }
    if (!DATE_PATTERN.test(leave_date)) {
      return res.status(400).json({ error: 'leave_date must be in YYYY-MM-DD format' });
    }
    if (!LEAVE_TYPES.includes(leave_type)) {
      return res.status(400).json({ error: `leave_type must be one of: ${LEAVE_TYPES.join(', ')}` });
    }

    const inserted = await pool.query(
      `INSERT INTO leave_reports (emp_id, leave_date, leave_type, remarks, reported_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [emp_id, leave_date, leave_type, remarks || null, reported_by || emp_id]
    );
    const leaveId = inserted.rows[0].id;

    if (req.file) {
      const photoType = PHOTO_MIME_TYPES.includes(req.file.mimetype) ? req.file.mimetype : 'image/jpeg';
      const photoPath = await uploadLeavePhoto(leaveId, req.file.buffer, photoType);
      await pool.query(
        `UPDATE leave_reports SET photo_path = $1, photo_uploaded_at = now() WHERE id = $2`,
        [photoPath, leaveId]
      );
    }

    const result = await pool.query(`SELECT ${LEAVE_SELECT} WHERE l.id = $1`, [leaveId]);
    const row = result.rows[0];
    const signedUrls = row.photo_path ? await getSignedUrls([row.photo_path]) : new Map();
    res.status(201).json({ ...row, photo_url: row.photo_path ? (signedUrls.get(row.photo_path) ?? null) : null });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'leave_reports_emp_date_unique') {
      // The unique index is what actually guarantees one report per employee
      // per date (race-safe); this just turns its rejection into a clear
      // message naming the leave that's already on file.
      const existing = await pool.query(
        'SELECT leave_type FROM leave_reports WHERE emp_id = $1 AND leave_date = $2',
        [req.body.emp_id, req.body.leave_date]
      );
      const type = existing.rows[0]?.leave_type;
      return res.status(409).json({
        error: `A leave has already been reported for ${req.body.leave_date}${type ? ` (${type})` : ''}. Only one leave report per date is allowed.`,
      });
    }
    if (err.code === '23503') {
      return res.status(400).json({ error: `Employee ${req.body.emp_id} not found` });
    }
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Invalid leave_type' });
    }
    next(err);
  }
});

// Backoffice "Reported Leaves" list — every submitted leave report, newest
// first. Signed photo URLs batched the same way GET /api/punches does.
router.get('/', requireBackofficeAuth, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${LEAVE_SELECT} ORDER BY l.leave_date DESC, l.created_at DESC`);
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

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || (err.message && err.message.startsWith('Unsupported file type'))) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
