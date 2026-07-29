const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMessageRows, validateRow } = require('../src/services/teamsParser');

const KNOWN = {
  employeeIds: new Set(['E1001', 'E1002']),
  projectCodes: new Set(['PRJ-001', 'PRJ-002']),
};

test('parseMessageRows extracts and skips the header row from an HTML table paste', () => {
  const message = {
    body: {
      contentType: 'html',
      content: `<table>
        <tr><td>Employee ID</td><td>Task Date</td><td>Project Code</td><td>Priority</td><td>Description</td><td>Location</td></tr>
        <tr><td>E1001</td><td>2026-08-01</td><td>PRJ-001</td><td>high</td><td>Do the thing</td><td>Site A</td></tr>
      </table>`,
    },
  };

  const rows = parseMessageRows(message);
  assert.equal(rows.length, 1, 'header row should be skipped, only the data row remains');
  assert.deepEqual(rows[0], ['E1001', '2026-08-01', 'PRJ-001', 'high', 'Do the thing', 'Site A']);
});

test('parseMessageRows falls back to comma-separated plain text when there is no HTML table', () => {
  const message = {
    body: {
      contentType: 'text',
      content: 'E1002,2026-08-02,PRJ-002,medium,Weekly check,Site B\nE1001,2026-08-03,PRJ-001,low,Another task,Site C',
    },
  };

  const rows = parseMessageRows(message);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['E1002', '2026-08-02', 'PRJ-002', 'medium', 'Weekly check', 'Site B']);
});

test('validateRow accepts a fully valid row', () => {
  const result = validateRow(
    ['E1001', '2026-08-01', 'PRJ-001', 'high', 'Do the thing', 'Site A'],
    KNOWN
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.task, {
    emp_id: 'E1001',
    taskDate: '2026-08-01',
    project_code: 'PRJ-001',
    priority: 'high',
    description: 'Do the thing',
    location_site: 'Site A',
  });
});

test('validateRow rejects an unknown employee', () => {
  const result = validateRow(['E9999', '2026-08-01', 'PRJ-001', 'high', 'x', ''], KNOWN);
  assert.equal(result.valid, false);
  assert.equal(result.empId, 'E9999');
  assert.match(result.reason, /not found/);
});

test('validateRow rejects an unknown project', () => {
  const result = validateRow(['E1001', '2026-08-01', 'PRJ-999', 'high', 'x', ''], KNOWN);
  assert.equal(result.valid, false);
  assert.equal(result.empId, 'E1001');
  assert.match(result.reason, /PRJ-999 not found/);
});

test('validateRow uses UNKNOWN when no employee ID can be parsed at all', () => {
  const result = validateRow(['', '2026-08-01', 'PRJ-001', 'high', 'x', ''], KNOWN);
  assert.equal(result.valid, false);
  assert.equal(result.empId, 'UNKNOWN');
});

test('validateRow rejects a malformed task date', () => {
  const result = validateRow(['E1001', 'not-a-date', 'PRJ-001', 'high', 'x', ''], KNOWN);
  assert.equal(result.valid, false);
  assert.match(result.reason, /YYYY-MM-DD/);
});
