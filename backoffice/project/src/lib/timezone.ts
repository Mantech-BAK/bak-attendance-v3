// The one timezone every backoffice page displays in (2026-09-28) — never
// the browser's own timezone. Bahrain has no DST and the same +3 offset as
// the Asia/Riyadh id this app used before; Asia/Bahrain is the more direct
// real IANA identifier for the country this app is actually built for.
// Every formatter in lib/utils.ts and every "today" calculation in
// lib/dateRange.ts imports this one constant — there is exactly one place
// the timezone is spelled out, so it can never drift between call sites.
export const BAHRAIN_TIME_ZONE = 'Asia/Bahrain';

// Bahrain's fixed UTC offset, in minutes — used only where plain offset
// arithmetic is simpler/more robust than an Intl call (AddPunchModal's
// wall-clock <-> UTC-instant conversion). Safe specifically because Bahrain
// never observes DST; this would be wrong for almost any other zone.
export const BAHRAIN_UTC_OFFSET_MINUTES = 180;
