const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { calculateAttendanceForEmployee, calculateAttendanceForAllEmployees } = require('../services/attendance');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Backoffice-only (all employees) — mobile only reads its own via
// /:emp_id below, which stays unauthenticated.
router.get('/', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (date && !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const { sessions, exceptionsRaised } = await calculateAttendanceForAllEmployees(date || undefined);
    res.json({ sessions, exceptions_raised: exceptionsRaised });
  } catch (err) {
    next(err);
  }
});

// Single-date attendance export (Reports page) — same sessions the on-screen
// "Attendance for a Specific Date" table shows, as a downloadable .xlsx.
// Must be declared before '/:emp_id' or "export" would be read as an emp_id.
router.get('/export', requireBackofficeAuth, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date || !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
    }

    const { sessions } = await calculateAttendanceForAllEmployees(date);
    const empIds = [...new Set(sessions.map((s) => s.emp_id))];
    const projectCodes = [...new Set(sessions.map((s) => s.project_code).filter(Boolean))];
    const [empResult, projResult] = await Promise.all([
      empIds.length
        ? pool.query('SELECT "EmpId" AS emp_id, "EmpName" AS name FROM employees WHERE "EmpId" = ANY($1)', [empIds])
        : { rows: [] },
      projectCodes.length
        ? pool.query('SELECT project_code, project_name FROM projects WHERE project_code = ANY($1)', [projectCodes])
        : { rows: [] },
    ]);
    const empNames = new Map(empResult.rows.map((r) => [r.emp_id, r.name]));
    const projNames = new Map(projResult.rows.map((r) => [r.project_code, r.project_name]));

    const fmt = (d) => (d ? new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '');
    const hm = (m) => (m === null || m === undefined ? '' : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance');
    sheet.columns = [
      { header: 'Employee ID', key: 'emp_id', width: 12 },
      { header: 'Employee', key: 'employee', width: 24 },
      { header: 'Project', key: 'project', width: 26 },
      { header: 'Punch In (Asia/Riyadh)', key: 'punch_in', width: 22 },
      { header: 'Punch Out (Asia/Riyadh)', key: 'punch_out', width: 22 },
      { header: 'Worked', key: 'worked', width: 12 },
      { header: 'Threshold', key: 'threshold', width: 12 },
      { header: 'Overtime', key: 'overtime', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const s of sessions) {
      sheet.addRow({
        emp_id: s.emp_id,
        employee: empNames.get(s.emp_id) ?? s.emp_id,
        project: (s.project_code && projNames.get(s.project_code)) || s.project_code || '',
        punch_in: fmt(s.punch_in.punch_time),
        punch_out: s.punch_out ? fmt(s.punch_out.punch_time) : 'Incomplete',
        worked: hm(s.counted_minutes),
        threshold: hm(s.threshold_minutes),
        overtime: s.is_overtime ? hm(s.overtime_minutes ?? 0) : '',
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.get('/:emp_id', async (req, res, next) => {
  try {
    const { emp_id } = req.params;
    const { date } = req.query;
    if (date && !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const employeeResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [emp_id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: `employee ${emp_id} not found` });
    }

    const { sessions, exceptionsRaised } = await calculateAttendanceForEmployee(emp_id, date || undefined);

    res.json({ emp_id, sessions, exceptions_raised: exceptionsRaised });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
