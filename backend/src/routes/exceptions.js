const express = require('express');
const pool = require('../db');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

// Every route in this file is backoffice-only — mobile never touches exceptions.
router.use(requireBackofficeAuth);

const VALID_STATUSES = ['open', 'resolved'];

// rp (referenced punch) is only populated for exceptions whose ref_table is
// 'punches' — currently just single_punch_only. Lets the backoffice's
// "Add Punch" action on an exception pre-fill the project and date from the
// existing incomplete punch, so the admin only has to supply the missing
// time.
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ex.id, ex.type, ex.emp_id, e."EmpName" AS employee_name, g.designation_name AS employee_designation,
              ex.ref_table, ex.ref_id, ex.details, ex.status, ex.created_at,
              rp.project_code AS ref_project_code, rp.punch_time AS ref_punch_time
       FROM exceptions ex
       LEFT JOIN employees e ON e."EmpId" = ex.emp_id
       LEFT JOIN designations g ON e."EmpDesigId" = g.designation_code
       LEFT JOIN punches rp ON ex.ref_table = 'punches' AND ex.ref_id = rp.id
       ORDER BY ex.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const existing = await pool.query('SELECT id FROM exceptions WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `exception ${id} not found` });
    }

    const result = await pool.query(
      `UPDATE exceptions
       SET status = $1
       WHERE id = $2
       RETURNING id, type, emp_id, ref_table, ref_id, details, status, created_at`,
      [status, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
