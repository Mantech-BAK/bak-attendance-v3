const cron = require('node-cron');
const { runDailyOtJob } = require('../services/otApprovals');

// 00:30 daily — shortly after the UTC day (which is what dateKey() uses
// throughout this app) has fully closed out, so the previous day's punches
// are final before evaluating OT.
const SCHEDULE = '30 0 * * *';

function startOtApprovalCron() {
  cron.schedule(SCHEDULE, async () => {
    console.log('[ot-approval-cron] starting daily OT evaluation');
    const result = await runDailyOtJob();
    console.log('[ot-approval-cron] finished', result);
  });

  console.log(`[ot-approval-cron] scheduled daily OT evaluation (cron: "${SCHEDULE}")`);
}

module.exports = { startOtApprovalCron };
