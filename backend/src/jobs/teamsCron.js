const cron = require('node-cron');
const { runTeamsSync } = require('../services/teamsSync');

// Every 5 minutes — task assignments are time-sensitive.
const SCHEDULE = '*/5 * * * *';

function startTeamsCron() {
  cron.schedule(SCHEDULE, async () => {
    console.log('[teams-cron] starting scheduled Teams sync');
    const result = await runTeamsSync();
    console.log('[teams-cron] finished', result);
  });

  console.log(`[teams-cron] scheduled Teams sync (cron: "${SCHEDULE}")`);
}

module.exports = { startTeamsCron };
