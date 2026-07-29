require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db');
const { runArtifySync } = require('../src/services/artifySync');

// E1001 is present in artifyClient.js's FAKE_EMPLOYEES stub, so a real sync
// run will upsert it.
const TEST_EMP_ID = 'E1001';

test('ARTIFY sync never overwrites an existing employee\'s biometric fields', async () => {
  const before = await pool.query(
    'SELECT face_template, fingerprint_template, registered_by, registered_at FROM employees WHERE emp_id = $1',
    [TEST_EMP_ID]
  );
  assert.equal(before.rows.length, 1, `${TEST_EMP_ID} must exist for this test`);
  const original = before.rows[0];

  const marker = {
    face_template: `test-marker-face-${Date.now()}`,
    fingerprint_template: `test-marker-fingerprint-${Date.now()}`,
    registered_by: 'test_admin_biometric_guard',
    registered_at: new Date('2020-01-01T00:00:00.000Z'),
  };

  try {
    await pool.query(
      `UPDATE employees
       SET face_template = $1, fingerprint_template = $2, registered_by = $3, registered_at = $4
       WHERE emp_id = $5`,
      [marker.face_template, marker.fingerprint_template, marker.registered_by, marker.registered_at, TEST_EMP_ID]
    );

    const syncResult = await runArtifySync();
    assert.equal(syncResult.success, true, 'ARTIFY sync run should succeed against the stub source');

    const after = await pool.query(
      'SELECT face_template, fingerprint_template, registered_by, registered_at FROM employees WHERE emp_id = $1',
      [TEST_EMP_ID]
    );
    const row = after.rows[0];

    assert.equal(row.face_template, marker.face_template, 'face_template must be untouched by sync');
    assert.equal(row.fingerprint_template, marker.fingerprint_template, 'fingerprint_template must be untouched by sync');
    assert.equal(row.registered_by, marker.registered_by, 'registered_by must be untouched by sync');
    assert.equal(row.registered_at.toISOString(), marker.registered_at.toISOString(), 'registered_at must be untouched by sync');
  } finally {
    await pool.query(
      `UPDATE employees
       SET face_template = $1, fingerprint_template = $2, registered_by = $3, registered_at = $4
       WHERE emp_id = $5`,
      [original.face_template, original.fingerprint_template, original.registered_by, original.registered_at, TEST_EMP_ID]
    );
    await pool.end();
  }
});
