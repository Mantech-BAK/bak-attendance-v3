const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;

    const result = status
      ? await pool.query(
          `SELECT project_code, project_name, company, status, cost_center
           FROM projects
           WHERE status = $1
           ORDER BY project_name`,
          [status]
        )
      : await pool.query(
          `SELECT project_code, project_name, company, status, cost_center
           FROM projects
           ORDER BY project_name`
        );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
