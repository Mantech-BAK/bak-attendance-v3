const pool = require('../db');

/**
 * Punch type (IN/OUT) is never stored — it's derived here, at calculation
 * time, from punch_time ordering within an (emp_id, project_code, day)
 * group: earliest = IN, latest = OUT (First-In-Last-Out). A group with
 * only one punch is an incomplete session and raises a 'single_punch_only'
 * exception for supervisor review.
 *
 * Rejected punches are excluded — a supervisor rejection explicitly
 * invalidates that punch, so letting it stand in as an official IN/OUT
 * time would defeat the point of the approval workflow.
 */

function dateKey(punchTime) {
  return punchTime.toISOString().slice(0, 10);
}

async function raiseSinglePunchException(empId, projectCode, date, punch) {
  const existing = await pool.query(
    `SELECT id FROM exceptions
     WHERE type = 'single_punch_only' AND ref_table = 'punches' AND ref_id = $1 AND status = 'open'`,
    [punch.id]
  );
  if (existing.rows.length > 0) {
    return null;
  }

  const details = `Employee ${empId} has only one punch for project ${projectCode || 'unassigned'} on ${date} — session is incomplete.`;

  const result = await pool.query(
    `INSERT INTO exceptions (type, emp_id, ref_table, ref_id, details, status)
     VALUES ('single_punch_only', $1, 'punches', $2, $3, 'open')
     RETURNING id, type, emp_id, ref_table, ref_id, details, status, created_at`,
    [empId, punch.id, details]
  );

  return result.rows[0];
}

async function calculateAttendanceForEmployee(empId) {
  const { rows } = await pool.query(
    `SELECT id, project_code, punch_time
     FROM punches
     WHERE emp_id = $1 AND approval_status <> 'rejected'
     ORDER BY project_code, punch_time`,
    [empId]
  );

  const groups = new Map();
  for (const row of rows) {
    const date = dateKey(row.punch_time);
    const key = `${row.project_code}|${date}`;
    if (!groups.has(key)) {
      groups.set(key, { projectCode: row.project_code, date, punches: [] });
    }
    groups.get(key).punches.push(row);
  }

  const sessions = [];
  const exceptionsRaised = [];

  for (const { projectCode, date, punches } of groups.values()) {
    const sorted = [...punches].sort((a, b) => a.punch_time - b.punch_time);
    const punchIn = sorted[0];
    const punchOut = sorted.length > 1 ? sorted[sorted.length - 1] : null;
    const incomplete = sorted.length === 1;

    if (incomplete) {
      const raised = await raiseSinglePunchException(empId, projectCode, date, punchIn);
      if (raised) {
        exceptionsRaised.push(raised);
      }
    }

    sessions.push({
      project_code: projectCode,
      date,
      punch_count: sorted.length,
      punch_in: { id: punchIn.id, punch_time: punchIn.punch_time },
      punch_out: punchOut ? { id: punchOut.id, punch_time: punchOut.punch_time } : null,
      incomplete,
    });
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { sessions, exceptionsRaised };
}

module.exports = { calculateAttendanceForEmployee };
