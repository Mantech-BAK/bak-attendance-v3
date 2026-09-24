// Default-to-today date scoping for the Punches / Tasks / Approvals pages
// (2026-09-24). Every date here is a plain YYYY-MM-DD string in Asia/Riyadh —
// BAK's real business-day zone, the same one the backend's dateKey() uses —
// never the browser's own timezone or a raw UTC slice.
export type PresetKey = 'today' | '3d' | '7d' | '15d' | '1m' | '3m';

export type DateRange = { start: string; end: string; preset: PresetKey | null };

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '3d', label: '3 days' },
  { key: '7d', label: '7 days' },
  { key: '15d', label: '15 days' },
  { key: '1m', label: '1 month' },
  { key: '3m', label: '3 months' },
];

export function dateKeyInRiyadh(value: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(value));
}

export function todayKey(): string {
  return dateKeyInRiyadh(new Date());
}

function shiftDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function shiftMonths(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function todayRange(): DateRange {
  const t = todayKey();
  return { start: t, end: t, preset: 'today' };
}

export function singleDayRange(day: string): DateRange {
  return { start: day, end: day, preset: null };
}

// Rolling window ending today, today included: "3 days" = today and the two
// days before; "1 month" = the day after this date one month ago, through
// today (so the boundary day is never double-counted).
export function presetRange(preset: PresetKey): DateRange {
  const end = todayKey();
  const start =
    preset === 'today' ? end
    : preset === '3d' ? shiftDays(end, -2)
    : preset === '7d' ? shiftDays(end, -6)
    : preset === '15d' ? shiftDays(end, -14)
    : preset === '1m' ? shiftDays(shiftMonths(end, -1), 1)
    : shiftDays(shiftMonths(end, -3), 1);
  return { start, end, preset };
}

export function isDefaultRange(range: DateRange): boolean {
  const t = todayKey();
  return range.start === t && range.end === t;
}

export function inRange(dayKey: string, range: DateRange): boolean {
  return dayKey >= range.start && dayKey <= range.end;
}
