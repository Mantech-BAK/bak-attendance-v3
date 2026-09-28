const { Pool } = require('pg');

// 2026-09-28: production was seen hanging on /health (a bare SELECT 1) for
// up to ~290s with nothing in the logs. Root cause: opening a NEW physical
// connection to Supabase's pooler is sometimes slow (observed 1s-290s from
// Render), and this pool had no connectionTimeoutMillis (pg's default is 0,
// meaning "wait forever"), so a slow connect just blocked the request
// indefinitely with no error, no timeout, nothing to log.
const CONNECTION_TIMEOUT_MS = 10_000; // most connects finish in ~1s; 10s means genuinely stalled
// pg's own default idleTimeoutMillis is 10s, which under light real-world
// traffic (gaps of a few minutes between admin actions) meant almost every
// request paid the slow-reconnect cost above. Keep idle connections around
// for a few minutes instead so normal usage patterns stay warm.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Runs once per NEW physical connection, before pg-pool hands it to
  // whoever is waiting (pool.query() or pool.connect()) — pg-pool's
  // _acquireClient does not call the pending caller's callback until this
  // callback fires (see pg-pool/index.js), so this is a real gate, not a
  // fire-and-forget hook. This replaces the old pool.on('connect', ...)
  // handler, which fired an UNAWAITED client.query() — pg-pool handed the
  // connection to the next caller immediately afterward, so the real query
  // could get queued behind the still-in-flight SET on the very same
  // client, which is exactly what triggered pg's own
  // "client.query() when the client is already executing a query" deprecation
  // warning, on every fresh connection.
  //
  // See the timezone rationale below — every new session is pinned to UTC
  // here, and only here; nothing about this depends on Supabase's own
  // session default (confirmed UTC in production today via SHOW timezone,
  // but this doesn't rely on that staying true).
  verify(client, cb) {
    client.query("SET timezone = 'UTC'", (err) => cb(err));
  },
});

// An idle client's connection can drop for reasons outside this app's
// control (network blip, the pooler recycling it) — pg emits that as an
// 'error' event on the pool. With no listener, Node treats an unhandled
// EventEmitter 'error' as fatal and crashes the whole process. This is the
// one thing standing between "one dropped idle connection" and a restart.
pool.on('error', (err) => {
  console.error('[db] idle client error (connection dropped, pool continues)', err);
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

const CONNECT_TIMEOUT_MESSAGES = ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'];

function isConnectTimeout(err) {
  return !!err && CONNECT_TIMEOUT_MESSAGES.some((m) => err.message && err.message.includes(m));
}

// Retry a stalled connect exactly once (2026-09-28) — most connects finish
// in ~1s, so a 10s timeout is already generous; a second consecutive
// timeout is treated as a real failure rather than retried again. This is
// the single choke point for acquiring a physical connection: pg-pool's
// own query() implementation calls `this.connect(...)` internally, and
// since this override replaces the instance's own `connect` property (which
// JS looks up before the prototype method), both pool.query(...) and any
// direct pool.connect() call (routes/tasks.js's manual transactions) go
// through this same retry logic.
const rawConnect = pool.connect.bind(pool);

function connectWithRetry(cb) {
  const attempt = async (isRetry) => {
    try {
      return await rawConnect();
    } catch (err) {
      if (isRetry || !isConnectTimeout(err)) throw err;
      console.error(`[db] connection attempt timed out after ${CONNECTION_TIMEOUT_MS}ms, retrying once`, err.message);
      return attempt(true);
    }
  };

  const promise = attempt(false);
  if (!cb) return promise;
  promise.then((client) => cb(undefined, client, client.release)).catch((err) => cb(err));
  return undefined;
}

pool.connect = connectWithRetry;

module.exports = pool;
