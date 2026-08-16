require('dotenv').config();
const pool = require('../src/db');
const { generateUniqueLoginCode } = require('../src/services/loginCode');

/**
 * Guarantees a real, working supervisor-with-direct-reports scenario exists
 * for manual/mobile testing — safe to re-run after any future data reset.
 * Idempotent: existing employees are updated in place, new ones are only
 * inserted (and only ever assigned a login_code) the first time they're
 * created, never overwritten on a later run.
 *
 * Two supervisors with disjoint teams are seeded (not just one) because the
 * "does supervisor A ever see supervisor B's team" isolation check needs a
 * second, independent team to test against.
 */
const SUPERVISOR_DESIGNATION_CODE = 'DES009';

const SUPERVISORS = [
  { empId: 'E1001', existingReports: ['E1003'] },
  { empId: 'E1005', existingReports: ['E1002'] },
];

const NEW_REPORTS = [
  { empId: 'E1009', name: 'Yusuf Bello', division: 'DIV001', dept: 'Engineering', desig: 'DES001', mgr: 'E1001', ot: true, religion: 'REL001', cpr: '901234575' },
  { empId: 'E1010', name: 'Zainab Suleiman', division: 'DIV001', dept: 'Engineering', desig: 'DES002', mgr: 'E1001', ot: true, religion: 'REL002', cpr: '901234576' },
  { empId: 'E1011', name: 'Ibrahim Musa', division: 'DIV002', dept: 'Operations', desig: 'DES003', mgr: 'E1005', ot: false, religion: 'REL001', cpr: '901234577' },
  { empId: 'E1012', name: 'Halima Bako', division: 'DIV002', dept: 'Operations', desig: 'DES004', mgr: 'E1005', ot: true, religion: 'REL002', cpr: '901234578' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure the Supervisor designation itself exists, in case a future
    // reset regenerates designations without it.
    await client.query(
      `INSERT INTO designations (designation_code, designation_name)
       VALUES ($1, 'Supervisor')
       ON CONFLICT (designation_code) DO UPDATE SET designation_name = 'Supervisor'`,
      [SUPERVISOR_DESIGNATION_CODE]
    );

    for (const { empId, existingReports } of SUPERVISORS) {
      const result = await client.query(
        `UPDATE employees SET "EmpDesigId" = $2 WHERE "EmpId" = $1 RETURNING "EmpId"`,
        [empId, SUPERVISOR_DESIGNATION_CODE]
      );
      if (result.rowCount === 0) {
        throw new Error(`Expected base employee ${empId} to already exist — seed only assigns the Supervisor designation, it does not create base employees.`);
      }

      for (const reportId of existingReports) {
        await client.query(`UPDATE employees SET "EmpReportMgrId" = $2 WHERE "EmpId" = $1`, [reportId, empId]);
      }
    }

    for (const r of NEW_REPORTS) {
      const existing = await client.query('SELECT 1 FROM employees WHERE "EmpId" = $1', [r.empId]);

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE employees SET "EmpName" = $2, "EmpDivision" = $3, "EmpDeptId" = $4, "EmpDesigId" = $5,
                  "EmpReportMgrId" = $6, "EmpStatus" = 'active', "EmpOtStatus" = $7, "EmpReligionId" = $8
           WHERE "EmpId" = $1`,
          [r.empId, r.name, r.division, r.dept, r.desig, r.mgr, r.ot, r.religion]
        );
      } else {
        const loginCode = await generateUniqueLoginCode(client);
        await client.query(
          `INSERT INTO employees
             ("EmpId", "EmpName", "EmpDivision", "EmpDeptId", "EmpDesigId", "EmpReportMgrId", "EmpStatus", "EmpOtStatus", "EmpReligionId", login_code, "EmpCpr")
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10)`,
          [r.empId, r.name, r.division, r.dept, r.desig, r.mgr, r.ot, r.religion, loginCode, r.cpr]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(async () => {
    console.log('Supervisor test data seeded successfully.');
    await pool.end();
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await pool.end();
    process.exit(1);
  });
