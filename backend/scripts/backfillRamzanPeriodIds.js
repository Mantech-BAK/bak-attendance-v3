// One-off backfill: adds `id` (crypto.randomUUID) and `active: true` to any
// existing ramzan_periods entry that predates the Settings page's Edit /
// Delete / Activate-Deactivate actions, which need a stable id to address a
// specific period. Idempotent — periods that already have both fields are
// left untouched, so safe to re-run.
require('dotenv').config();
const crypto = require('crypto');
const pool = require('../src/db');
const { getSetting, setSetting } = require('../src/services/settings');

async function main() {
  const raw = await getSetting('ramzan_periods');
  if (!raw) {
    console.log('No ramzan_periods setting found — nothing to backfill.');
    return;
  }

  const periods = JSON.parse(raw);
  let changed = false;
  const backfilled = periods.map((period) => {
    if (period.id && period.active !== undefined) return period;
    changed = true;
    return { ...period, id: period.id || crypto.randomUUID(), active: period.active ?? true };
  });

  if (!changed) {
    console.log('Every period already has id + active — nothing to do.');
    return;
  }

  await setSetting('ramzan_periods', JSON.stringify(backfilled));
  console.log(`Backfilled ${backfilled.length} period(s):`, backfilled);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
