require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db');
const { runArtifySync } = require('../src/services/artifySync');

after(() => pool.end());

// E1001 is present in artifyClient.js's FAKE_EMPLOYEES stub, so a real sync
// run will upsert it.
const TEST_EMP_ID = 'E1001';

test('ARTIFY sync never overwrites an existing employee\'s biometric fields or login_code', async () => {
  const before = await pool.query(
    `SELECT "EmpFaceId", "EmpFingerId", "EmpRegistredBy", "EmpRegisteredAt", login_code
     FROM employees WHERE "EmpId" = $1`,
    [TEST_EMP_ID]
  );
  assert.equal(before.rows.length, 1, `${TEST_EMP_ID} must exist for this test`);
  const original = before.rows[0];

  const marker = {
    face_template: `test-marker-face-${Date.now()}`,
    fingerprint_template: `test-marker-fingerprint-${Date.now()}`,
    registered_by: 'test_admin_biometric_guard',
    registered_at: new Date('2020-01-01T00:00:00.000Z'),
    login_code: 'ZZZZZ',
  };

  try {
    await pool.query(
      `UPDATE employees
       SET "EmpFaceId" = $1, "EmpFingerId" = $2, "EmpRegistredBy" = $3, "EmpRegisteredAt" = $4, login_code = $5
       WHERE "EmpId" = $6`,
      [marker.face_template, marker.fingerprint_template, marker.registered_by, marker.registered_at, marker.login_code, TEST_EMP_ID]
    );

    const syncResult = await runArtifySync();
    assert.equal(syncResult.success, true, 'ARTIFY sync run should succeed against the stub source');

    const afterSync = await pool.query(
      `SELECT "EmpFaceId", "EmpFingerId", "EmpRegistredBy", "EmpRegisteredAt", login_code
       FROM employees WHERE "EmpId" = $1`,
      [TEST_EMP_ID]
    );
    const row = afterSync.rows[0];

    assert.equal(row.EmpFaceId, marker.face_template, 'EmpFaceId must be untouched by sync');
    assert.equal(row.EmpFingerId, marker.fingerprint_template, 'EmpFingerId must be untouched by sync');
    assert.equal(row.EmpRegistredBy, marker.registered_by, 'EmpRegistredBy must be untouched by sync');
    assert.equal(row.EmpRegisteredAt.toISOString(), marker.registered_at.toISOString(), 'EmpRegisteredAt must be untouched by sync');
    assert.equal(row.login_code, marker.login_code, 'login_code must be untouched by sync');
  } finally {
    await pool.query(
      `UPDATE employees
       SET "EmpFaceId" = $1, "EmpFingerId" = $2, "EmpRegistredBy" = $3, "EmpRegisteredAt" = $4, login_code = $5
       WHERE "EmpId" = $6`,
      [original.EmpFaceId, original.EmpFingerId, original.EmpRegistredBy, original.EmpRegisteredAt, original.login_code, TEST_EMP_ID]
    );
  }
});

// (BAK Holdings, Engineering) is present in artifyClient.js's
// FAKE_DEPARTMENTS stub, so a real sync run will upsert it.
const TEST_DEPT = { company: 'BAK Holdings', department_name: 'Engineering' };

test('ARTIFY sync never overwrites an existing department\'s default_project_code', async () => {
  const before = await pool.query(
    'SELECT default_project_code FROM departments WHERE company_dept_id = $1 AND department_name = $2',
    [TEST_DEPT.company, TEST_DEPT.department_name]
  );
  assert.equal(before.rows.length, 1, `(${TEST_DEPT.company}, ${TEST_DEPT.department_name}) must exist for this test`);
  const original = before.rows[0];

  const marker = 'PRJ-001';

  try {
    await pool.query(
      'UPDATE departments SET default_project_code = $1 WHERE company_dept_id = $2 AND department_name = $3',
      [marker, TEST_DEPT.company, TEST_DEPT.department_name]
    );

    const syncResult = await runArtifySync();
    assert.equal(syncResult.success, true, 'ARTIFY sync run should succeed against the stub source');

    const after = await pool.query(
      'SELECT default_project_code FROM departments WHERE company_dept_id = $1 AND department_name = $2',
      [TEST_DEPT.company, TEST_DEPT.department_name]
    );

    assert.equal(after.rows[0].default_project_code, marker, 'default_project_code must be untouched by sync');
  } finally {
    await pool.query(
      'UPDATE departments SET default_project_code = $1 WHERE company_dept_id = $2 AND department_name = $3',
      [original.default_project_code, TEST_DEPT.company, TEST_DEPT.department_name]
    );
  }
});
