export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour12: true,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-US', {
    hour12: true,
    hour: 'numeric',
    minute: '2-digit',
  });
}

// "X hour(s) Y minute(s)" (2026-09-15) — replaces every decimal "X.Xh"
// display across the backoffice with a readable, always-both-parts format
// (e.g. "2 hours 30 minutes", "1 hour 0 minutes", "0 hours 45 minutes").
// Takes minutes, not hours, since almost every caller already has a real
// minutes value straight from the backend — converting a decimal-hours
// value first (Math.round(hours * 60)) is the caller's job.
export function formatDurationHM(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function formatDurationHours(start: string, end: string | null): string {
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return formatDurationHM(ms / 60000);
}

// Raw lat/lng (never the resolved text address, for accuracy) — standard
// Google Maps "search at this point" URL, opened in a new tab.
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// The one place every widget's "status → color" mapping comes from —
// donut chart segments, stat card accents, badges — so a status reads the
// same color everywhere on the page instead of each widget picking its own
// shade. success = done/approved, warning = in-progress/pending, danger =
// rejected/blocked, info = scheduled/neutral-but-notable, neutral = plain.
export type Grade = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const GRADE: Record<
  Grade,
  { dot: string; stroke: string; text: string; bg: string; ring: string }
> = {
  success: { dot: 'bg-emerald-500', stroke: 'stroke-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
  warning: { dot: 'bg-amber-500', stroke: 'stroke-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', ring: 'ring-amber-200' },
  danger: { dot: 'bg-rose-500', stroke: 'stroke-rose-500', text: 'text-rose-700', bg: 'bg-rose-50', ring: 'ring-rose-200' },
  info: { dot: 'bg-sky-500', stroke: 'stroke-sky-500', text: 'text-sky-700', bg: 'bg-sky-50', ring: 'ring-sky-200' },
  neutral: { dot: 'bg-slate-400', stroke: 'stroke-slate-400', text: 'text-slate-600', bg: 'bg-slate-100', ring: 'ring-slate-200' },
};
