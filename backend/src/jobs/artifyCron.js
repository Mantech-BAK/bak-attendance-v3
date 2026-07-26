const cron = require('node-cron');
const { runArtifySync } = require('../services/artifySync');

// Runs once a day at 02:00 server time.
const SCHEDULE = '0 2 * * *';

function startArtifyCron() {
  cron.schedule(SCHEDULE, async () => {
    console.log('[artify-cron] starting scheduled ARTIFY sync');
    const result = await runArtifySync();
    console.log('[artify-cron] finished', result);
  });

  console.log(`[artify-cron] scheduled ARTIFY sync (cron: "${SCHEDULE}")`);
}

module.exports = { startArtifyCron };
