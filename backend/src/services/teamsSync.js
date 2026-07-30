const pool = require('../db');
const { fetchChannelMessages, postReplyToThread } = require('../integrations/teamsClient');
const { parseMessageRows, validateRow } = require('./teamsParser');
const { createTask, TaskValidationError } = require('./tasks');
const { getSetting, setSetting } = require('./settings');

// Reuses artify_sync_log rather than a dedicated table — its sync_type
// column already exists precisely to distinguish different sync jobs.
const SYNC_TYPE = 'teams_pull';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000];
const EPOCH = '1970-01-01T00:00:00.000Z';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFailureMessage(empId, reason) {
  return `task assignment for emp with empid ${empId} failed because of ${reason}`;
}

async function logSyncRun({ status, detail, attemptCount }) {
  await pool.query(
    `INSERT INTO artify_sync_log (sync_type, status, detail, attempt_count)
     VALUES ($1, $2, $3, $4)`,
    [SYNC_TYPE, status, detail, attemptCount]
  );
}

async function logSyncFailureException({ details }) {
  await pool.query(
    `INSERT INTO exceptions (type, ref_table, details)
     VALUES ($1, $2, $3)`,
    ['teams_sync_failure', 'artify_sync_log', details]
  );
}

// ref_id stays null — Teams message IDs are strings, not the integer this
// column expects. ref_table is a loose descriptive tag, same convention
// artify_sync_failure already uses for ref_table='artify_sync_log'.
async function logTaskFailureException(empId, detailMessage) {
  await pool.query(
    `INSERT INTO exceptions (type, emp_id, ref_table, details, status)
     VALUES ('teams_task_assignment_failed', $1, 'teams_message', $2, 'open')`,
    [empId === 'UNKNOWN' ? null : empId, detailMessage]
  );
}

/**
 * Every row in a message is validated and processed independently — valid
 * rows create tasks immediately, invalid ones are collected. A message with
 * any failures gets exactly one batched reply listing all of them, not one
 * reply per row.
 */
async function processMessage(message, { authorizedSender, createdByEmpId, employeeIds, projectCodes }) {
  if (message.from?.email !== authorizedSender) {
    return { skipped: true };
  }

  const rows = parseMessageRows(message);
  const failures = [];
  let tasksCreated = 0;

  for (const cells of rows) {
    const result = validateRow(cells, { employeeIds, projectCodes });

    if (!result.valid) {
      failures.push({ empId: result.empId, reason: result.reason });
      continue;
    }

    try {
      await createTask({
        emp_id: result.task.emp_id,
        project_code: result.task.project_code,
        priority: result.task.priority,
        description: result.task.description,
        location_site: result.task.location_site,
        source: 'teams',
        created_by: createdByEmpId,
        taskDate: result.task.taskDate,
      });
      tasksCreated += 1;
    } catch (err) {
      const reason = err instanceof TaskValidationError ? err.message : 'unexpected error creating the task';
      failures.push({ empId: result.task.emp_id, reason });
    }
  }

  for (const failure of failures) {
    await logTaskFailureException(failure.empId, buildFailureMessage(failure.empId, failure.reason));
  }

  let reply = null;
  if (failures.length > 0) {
    const replyText = failures.map((f) => buildFailureMessage(f.empId, f.reason)).join('\n');
    reply = await postReplyToThread(message.channelId, message.id, replyText);
  }

  return { skipped: false, tasksCreated, failureCount: failures.length, reply };
}

async function runTeamsSyncAttempt() {
  const [authorizedSender, createdByEmpId, lastSynced, employeesResult, projectsResult] = await Promise.all([
    getSetting('teams_authorized_sender'),
    getSetting('teams_authorized_sender_emp_id'),
    getSetting('teams_last_synced'),
    pool.query('SELECT "EmpId" AS emp_id FROM employees'),
    pool.query('SELECT project_code FROM projects'),
  ]);

  const employeeIds = new Set(employeesResult.rows.map((row) => row.emp_id));
  const projectCodes = new Set(projectsResult.rows.map((row) => row.project_code));

  const messages = await fetchChannelMessages(lastSynced || EPOCH);

  let messagesProcessed = 0;
  let messagesSkipped = 0;
  let tasksCreated = 0;
  let failuresLogged = 0;
  const repliesSent = [];

  for (const message of messages) {
    const result = await processMessage(message, { authorizedSender, createdByEmpId, employeeIds, projectCodes });

    if (result.skipped) {
      messagesSkipped += 1;
      continue;
    }

    messagesProcessed += 1;
    tasksCreated += result.tasksCreated;
    failuresLogged += result.failureCount;
    if (result.reply) repliesSent.push(result.reply);
  }

  if (messages.length > 0) {
    await setSetting('teams_last_synced', messages[messages.length - 1].createdDateTime);
  }

  return { messagesProcessed, messagesSkipped, tasksCreated, failuresLogged, repliesSent };
}

/**
 * Runs the Teams task-intake sync with the same retry discipline as the
 * ARTIFY sync (3 attempts, increasing delay) — this retries the fetch/
 * processing cycle itself (e.g. a transient Graph API failure), never
 * individual row validation failures, which are terminal and logged once.
 */
async function runTeamsSync() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runTeamsSyncAttempt();
      const detail = `Processed ${result.messagesProcessed} messages (${result.messagesSkipped} skipped), created ${result.tasksCreated} tasks, logged ${result.failuresLogged} failures`;
      await logSyncRun({ status: 'success', detail, attemptCount: attempt });
      return { success: true, attempt, ...result };
    } catch (err) {
      lastError = err;
      await logSyncRun({ status: 'failed', detail: err.message, attemptCount: attempt });

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }

  await logSyncFailureException({
    details: `Teams sync failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`,
  });

  return { success: false, attempts: MAX_ATTEMPTS, error: lastError.message };
}

module.exports = { runTeamsSync };
