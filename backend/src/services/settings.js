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

// Matches confirmationSheetExcel.js/dailyConfirmation.js's own
// REPORT_TIME_ZONE — BAK's real operating timezone, already established
// there for the same reason: a human (here, the admin setting this window)
// thinks in local wall-clock time, not UTC-instant. Storage and the actual
// window comparison stay UTC (see isWithinEmergencyWindow below) — only
// entry/display convert.
const BUSINESS_TIME_ZONE = 'Asia/Riyadh';

// The business timezone's UTC offset, in minutes, at the given instant
// (positive = ahead of UTC) — derived via Intl rather than hardcoded +3, so
// this keeps working correctly even though Asia/Riyadh currently has no DST
// to account for.
function getBusinessTimeZoneOffsetMinutes(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asIfUtc - instant.getTime()) / 60000);
}

// Converts a "HH:MM" wall-clock reading in Asia/Riyadh (what an admin
// actually types into the Settings UI) into the equivalent "HH:MM" in UTC,
// for storage. The offset is derived from the naive (uncorrected) instant
// rather than iterated to convergence — exact here specifically because
// Asia/Riyadh's offset is constant (no DST), so there's no transition
// boundary where the naive and corrected instant could disagree; this
// would need a second pass for a zone that does observe DST.
function localHHMMToUtcHHMM(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const now = new Date();
  const naiveUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m);
  const offsetMinutes = getBusinessTimeZoneOffsetMinutes(new Date(naiveUtc));
  const actualUtc = new Date(naiveUtc - offsetMinutes * 60000);
  return `${String(actualUtc.getUTCHours()).padStart(2, '0')}:${String(actualUtc.getUTCMinutes()).padStart(2, '0')}`;
}

// Converts a stored "HH:MM" UTC value into the equivalent "HH:MM" wall-clock
// reading in Asia/Riyadh, for display — the reverse of localHHMMToUtcHHMM.
// Same toLocaleTimeString-with-timeZone technique already established in
// confirmationSheetExcel.js/dailyConfirmation.js; only the hour/minute are
// read back out, so a midnight-crossing offset (e.g. 23:30 UTC -> 02:30
// Riyadh, technically the next day) still comes out correct — there's no
// caller here that cares which calendar day it falls on, only the
// time-of-day.
function utcHHMMToLocalHHMM(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const now = new Date();
  const utcInstant = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(utcInstant);
}

const DEFAULT_EMERGENCY_START = '22:00';
const DEFAULT_EMERGENCY_END = '06:00';

// The nightly window an employee is allowed to create a task for themselves
// (mobile, no supervisor/backoffice involved) — outside it, only a
// supervisor or backoffice can assign them work, same as before this
// feature existed. Falls back to the documented default (10pm-6am) whenever
// unset, same "never a hard failure just because nobody's touched the
// setting yet" reasoning as getDuplicatePunchWindowMinutes above.
async function getEmergencyTimeAllowance() {
  const [start, end] = await Promise.all([
    getSetting('emergency_time_allowance_start'),
    getSetting('emergency_time_allowance_end'),
  ]);
  return {
    start: start || DEFAULT_EMERGENCY_START,
    end: end || DEFAULT_EMERGENCY_END,
  };
}

function parseHHMM(value) {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + m;
}

// Compared in UTC, not the server process's local timezone or the caller's
// device time — same "never trust anything but the server's own clock"
// principle punch_time itself already follows elsewhere in this app. A
// window where start === end is treated as always-open rather than
// always-closed (an admin who sets it that way almost certainly means "no
// restriction", not "block everyone").
async function isWithinEmergencyWindow(now = new Date()) {
  const { start, end } = await getEmergencyTimeAllowance();
  const startMinutes = parseHHMM(start);
  const endMinutes = parseHHMM(end);
  if (startMinutes === endMinutes) return true;

  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window (e.g. the 22:00-06:00 default) wraps past midnight.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

module.exports = {
  getSetting,
  setSetting,
  getAllSettings,
  parseRamzanPeriods,
  getRamzanPeriods,
  getDuplicatePunchWindowMinutes,
  DEFAULT_DUPLICATE_WINDOW_MINUTES,
  getEmergencyTimeAllowance,
  isWithinEmergencyWindow,
  DEFAULT_EMERGENCY_START,
  DEFAULT_EMERGENCY_END,
  BUSINESS_TIME_ZONE,
  localHHMMToUtcHHMM,
  utcHHMMToLocalHHMM,
};
