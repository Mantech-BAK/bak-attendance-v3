const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'punch-photos';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h — long enough for one admin review session

// Bounded window (2026-09-14) after an OUT punch during which its photo
// must be uploaded before starting a DIFFERENT real task. Shared between
// routes/punches.js (the live block on a new punch) and
// jobs/missingPunchPhotoCron.js (raises a missing_punch_photo exception
// once this window lapses unresolved, and lifts the live block from then
// on) — kept in one place so the two can never drift out of sync.
const OUT_PHOTO_WINDOW_HOURS = 3;

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL/SUPABASE_SERVICE_KEY are not set');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return client;
}

// role is 'in' | 'out' — which of the task's (at most) two punches this is.
// One object per punch, so a re-upload attempt is blocked at the route
// level (photo_path already set) well before this would ever collide.
function buildPath(punchId, role) {
  return `punches/${punchId}/${role}.jpg`;
}

async function uploadPunchPhoto(punchId, role, buffer, contentType) {
  const path = buildPath(punchId, role);
  const { error } = await getClient().storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Batched — the backoffice punch list can have many photographed rows at
// once; one round trip beats one signed-URL request per row.
async function getSignedUrls(paths) {
  if (paths.length === 0) return new Map();
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  const map = new Map();
  for (const entry of data) {
    if (entry.signedUrl) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

module.exports = { uploadPunchPhoto, getSignedUrls, BUCKET, OUT_PHOTO_WINDOW_HOURS };
