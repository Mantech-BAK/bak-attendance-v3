const cron = require('node-cron');
const { sweepMissingPunchPhotos } = require('../services/missingPunchPhotoExceptions');

// Every 15 minutes — the window itself is hours (OUT_PHOTO_WINDOW_HOURS in
// punchPhotoStorage.js), so this only needs to be frequent enough that a
// lapsed window gets flagged promptly, not to the minute.
const SCHEDULE = '*/15 * * * *';

function startMissingPunchPhotoCron() {
  cron.schedule(SCHEDULE, async () => {
    const result = await sweepMissingPunchPhotos();
    if (result.raised > 0) {
      console.log('[missing-punch-photo-cron] raised', result.raised, 'new exception(s) of', result.checked, 'checked');
    }
  });

  console.log(`[missing-punch-photo-cron] scheduled (cron: "${SCHEDULE}")`);
}

module.exports = { startMissingPunchPhotoCron };
