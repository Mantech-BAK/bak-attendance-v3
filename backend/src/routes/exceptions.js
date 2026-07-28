const express = require('express');
const pool = require('../db');

const router = express.Router();

const VALID_STATUSES = ['open', 'resolved'];

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ex.id, ex.type, ex.emp_id, e.name AS employee_name, e.designation AS employee_designation,
              ex.ref_table, ex.ref_id, ex.details, ex.status, ex.created_at
       FROM exceptions ex
       LEFT JOIN employees e ON e.emp_id = ex.emp_id
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
