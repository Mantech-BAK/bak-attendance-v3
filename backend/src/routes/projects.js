const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT project_code, project_name, company, status
       FROM projects
       WHERE status = 'OPEN'
       ORDER BY project_name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
