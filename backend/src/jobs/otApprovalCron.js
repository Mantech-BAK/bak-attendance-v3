const cron = require('node-cron');
const { runDailyOtJob } = require('../services/otApprovals');

// 00:30 Asia/Riyadh daily — shortly after the real Bahrain business day
// (which is what dateKey()/getBahrainDateKey() use throughout this app,
// since the 2026-09-16 timezone audit) has fully closed out, so the
// previous day's punches are final before evaluating OT. The explicit
// `timezone` option below is what actually makes "00:30" mean Riyadh time
// — node-cron otherwise fires at 00:30 in whatever timezone the server
// process itself happens to be running in (previously unset here, so this
// used to mean UTC 00:30 = 03:30 Bahrain, evaluating a day-window shifted
// ~3 hours from the real Bahrain business day).
const SCHEDULE = '30 0 * * *';
const SCHEDULE_TIMEZONE = 'Asia/Riyadh';

function startOtApprovalCron() {
  cron.schedule(SCHEDULE, async () => {
    console.log('[ot-approval-cron] starting daily OT evaluation');
    const result = await runDailyOtJob();
    console.log('[ot-approval-cron] finished', result);
  }, { timezone: SCHEDULE_TIMEZONE });

  console.log(`[ot-approval-cron] scheduled daily OT evaluation (cron: "${SCHEDULE}" ${SCHEDULE_TIMEZONE})`);
}

module.exports = { startOtApprovalCron };
