const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Every new connection is pinned to UTC explicitly (2026-09-16 timezone
// audit) — deliberately NOT Asia/Riyadh, even though this app's real
// business day boundary is Asia/Riyadh. Every timestamp column in this
// schema (punch_time, created_at, approved_at, photo_uploaded_at, ...) is
// "timestamp without time zone", written as a literal UTC clock reading
// (node-pg serializes a JS Date's own UTC value with no timezone suffix).
// Real elapsed-time logic throughout the app — the 3h out-photo window,
// the near-duplicate punch window, the missing-photo-cron sweep — compares
// those naive columns directly against now()/interval arithmetic. Postgres
// resolves a naive-vs-timestamptz comparison by interpreting the naive
// value AS IF it were wall-clock time in the SESSION's timezone: confirmed
// by direct test that setting the session to Asia/Riyadh here would make
// every one of those comparisons silently wrong by exactly 3 hours (a
// punch's own naive UTC reading would get reinterpreted as if it were a
// Riyadh reading, shifting its effective instant back by 3h). Production
// already happened to default to UTC (Supabase's own default) and was
// correct on this axis; local dev happened to default to something else
// and was silently wrong on this SAME axis, undetected because nothing here
// was ever pinned explicitly.
//
// The actual Bahrain-business-day concern (task_date defaults, open/close
// day boundaries, Shift Type attribution, Ramzan/Summer-Ban "today", the OT
// cron's "yesterday") is handled entirely in JS via
// services/settings.js's getBahrainDateKey() (Intl-based, explicit
// timeZone: 'Asia/Riyadh'), which needs no Postgres session timezone
// cooperation at all — so pinning this to UTC costs that logic nothing,
// while fixing the naive-timestamp elapsed-time logic and making local and
// production agree with each other for good.
pool.on('connect', (client) => {
  client.query('SET timezone = \'UTC\'').catch((err) => {
    console.error('[db] failed to pin session timezone to UTC', err);
  });
});

module.exports = pool;
