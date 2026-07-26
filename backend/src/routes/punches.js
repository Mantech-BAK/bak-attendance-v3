const express = require('express');
const pool = require('../db');

const router = express.Router();

const VALID_TYPES = ['IN', 'OUT'];

router.post('/', async (req, res, next) => {
  try {
    const { emp_id, type, project_code, lat, lng, entered_by, device_ref, recorded_at } = req.body;

    if (!emp_id) {
      return res.status(400).json({ error: 'emp_id is required' });
    }
    if (!type || !VALID_TYPES.includes(String(type).toUpperCase())) {
      return res.status(400).json({ error: 'type must be "IN" or "OUT"' });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng are required numbers' });
    }

    const punchType = String(type).toUpperCase();
    const enteredBy = entered_by || emp_id;

    const employeeResult = await pool.query(
      'SELECT emp_id FROM employees WHERE emp_id = $1',
      [emp_id]
    );
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    if (project_code) {
      const projectResult = await pool.query(
        'SELECT project_code FROM projects WHERE project_code = $1',
        [project_code]
      );
      if (projectResult.rows.length === 0) {
        return res.status(400).json({ error: `project ${project_code} not found` });
      }
    }

    let entryMethod = 'self';
    let approvalStatus = 'pending';

    if (enteredBy !== emp_id) {
      entryMethod = 'supervisor';

      const enteredByResult = await pool.query(
        'SELECT emp_id, designation FROM employees WHERE emp_id = $1',
        [enteredBy]
      );
      if (enteredByResult.rows.length === 0) {
        return res.status(400).json({ error: `entered_by ${enteredBy} not found` });
      }

      // Only a true supervisor entering on someone else's behalf is auto-approved.
      approvalStatus = enteredByResult.rows[0].designation === 'Supervisor' ? 'approved' : 'pending';
    }

    const punchTime = recorded_at ? new Date(recorded_at) : new Date();

    const result = await pool.query(
      `INSERT INTO punches
         (emp_id, project_code, punch_type, punch_time, lat, lng, device_ref, entered_by, entry_method, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, emp_id, project_code, punch_type, punch_time, lat, lng, device_ref,
                 entered_by, entry_method, approval_status, approved_by, approved_at, created_at`,
      [emp_id, project_code || null, punchType, punchTime, lat, lng, device_ref || null, enteredBy, entryMethod, approvalStatus]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
