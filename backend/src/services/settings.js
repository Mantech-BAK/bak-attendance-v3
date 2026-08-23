const pool = require('../db');

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [key]);
  return rows.length > 0 ? rows[0].value : null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO system_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

// Fetches every row at once — the table is small, and callers like
// calculateAttendance() need to look up several keys (the global default
// plus a daily_working_hours:<date> per session) without a query per key.
async function getAllSettings() {
  const { rows } = await pool.query('SELECT key, value FROM system_settings');
  const map = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

function parseRamzanPeriods(settingsMap) {
  const raw = settingsMap.ramzan_periods;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getRamzanPeriods() {
  const value = await getSetting('ramzan_periods');
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const DEFAULT_DUPLICATE_WINDOW_MINUTES = 5;

// Falls back to the default whenever unset or corrupted rather than
// throwing — the duplicate-punch check must always have a usable window,
// never a hard failure just because the setting hasn't been touched yet.
async function getDuplicatePunchWindowMinutes() {
  const value = await getSetting('duplicate_punch_window_minutes');
  const minutes = value === null ? DEFAULT_DUPLICATE_WINDOW_MINUTES : Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_DUPLICATE_WINDOW_MINUTES;
}

module.exports = {
  getSetting,
  setSetting,
  getAllSettings,
  parseRamzanPeriods,
  getRamzanPeriods,
  getDuplicatePunchWindowMinutes,
  DEFAULT_DUPLICATE_WINDOW_MINUTES,
};
