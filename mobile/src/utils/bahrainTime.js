// The one timezone every mobile screen displays in (2026-09-28) — never the
// device's own timezone. Bahrain has no DST and the same +3 offset as the
// Asia/Riyadh id used server-side; nothing here ever reads the device's
// configured timezone or locale for anything.
export const BAHRAIN_TIME_ZONE = 'Asia/Bahrain';
const BAHRAIN_UTC_OFFSET_MINUTES = 180; // UTC+3, constant year-round (no DST)
const BAHRAIN_OFFSET_MS = BAHRAIN_UTC_OFFSET_MINUTES * 60000;

// Self-VERIFIED once at module load, not assumed — Hermes on Android has
// shipped with full ICU/Intl data for years, but this proves it on the
// actual running engine rather than trusting that. A known instant
// (2026-01-01T00:00:00Z, i.e. 03:00 in Bahrain) is formatted with the real
// timeZone option; if Intl doesn't understand 'Asia/Bahrain' at all (throws)
// or silently ignores the timeZone option — a real failure mode on a
// minimal/lean ICU build, where it would print the DEVICE's own local hour
// instead of 03:00 — every helper below falls back to plain +3h offset
// arithmetic instead, which is exact for a zone with no DST.
function detectIntlSupport() {
  try {
    const probe = new Intl.DateTimeFormat('en-GB', {
      timeZone: BAHRAIN_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    return probe.replace(/[^\d:]/g, '') === '03:00';
  } catch {
    return false;
  }
}

const INTL_SUPPORTS_BAHRAIN = detectIntlSupport();

// Exposed only so a screen can surface which path is active if ever needed
// for support/debugging — not used by any of the formatters below.
export function bahrainIntlSupported() {
  return INTL_SUPPORTS_BAHRAIN;
}

function shiftToBahrain(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(d.getTime() + BAHRAIN_OFFSET_MS);
}

// 'YYYY-MM-DD' for the given instant (defaults to now) as a Bahrain
// calendar date — every "today" default and date-key computation.
export function bahrainDateKey(value = new Date()) {
  if (INTL_SUPPORTS_BAHRAIN) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BAHRAIN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  const shifted = shiftToBahrain(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function bahrainParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (INTL_SUPPORTS_BAHRAIN) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BAHRAIN_TIME_ZONE, weekday: 'short', month: 'short', day: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
    return {
      weekday: get('weekday'), month: get('month'), day: get('day'), year: get('year'),
      hour: get('hour'), minute: get('minute'), dayPeriod: get('dayPeriod'),
    };
  }
  const shifted = shiftToBahrain(d);
  const hour24 = shifted.getUTCHours();
  const dayPeriod = hour24 < 12 ? 'AM' : 'PM';
  let hour = hour24 % 12;
  if (hour === 0) hour = 12;
  return {
    weekday: WEEKDAYS[shifted.getUTCDay()],
    month: MONTHS[shifted.getUTCMonth()],
    day: String(shifted.getUTCDate()).padStart(2, '0'),
    year: String(shifted.getUTCFullYear()),
    hour: String(hour),
    minute: String(shifted.getUTCMinutes()).padStart(2, '0'),
    dayPeriod,
  };
}

// e.g. "2:30 PM" — Bahrain wall-clock time for a real instant.
export function formatBahrainTime(value) {
  const p = bahrainParts(value);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

// e.g. "Sep 24, 2026, 2:30 PM"
export function formatBahrainDateTime(value) {
  const p = bahrainParts(value);
  return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

// e.g. "Thu, Sep 24, 2026" for a plain 'YYYY-MM-DD' key (the Report Leave
// date picker's selected day) — never reinterprets it through Bahrain, the
// device, or any other timezone. The key already IS the calendar day; this
// only picks the right weekday/month name for it, anchored at UTC so no
// timezone conversion (not even a correctly Bahrain-pinned one) can shift it
// off its own day.
export function formatPlainDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (INTL_SUPPORTS_BAHRAIN) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[utcDate.getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
