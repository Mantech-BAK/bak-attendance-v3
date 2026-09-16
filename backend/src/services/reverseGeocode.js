const TIMEOUT_MS = 5000;

/**
 * Real reverse geocoding via LocationIQ (same underlying OpenStreetMap data
 * as Nominatim, same response shape — display_name etc. — just through a
 * real API key). Called synchronously at punch-creation time. Must never
 * block or fail the punch itself — any error, timeout, or non-2xx response
 * resolves to null (logged server-side only) rather than throwing. This is
 * a display-only lookup — unlike lat/lng capture itself (required for
 * mobile/supervisor-app punches, enforced in routes/punches.js), a failed
 * address resolution never blocks anything; the punch just shows without a
 * human-readable address.
 *
 * Replaces the earlier Nominatim public-instance integration (2026-09-14):
 * confirmed the exact same coordinates resolved fine from a local machine
 * but consistently returned null through the live production server —
 * Nominatim's free public instance throttling/blocking Render's shared
 * egress IP, not a bug in this code. LOCATIONIQ_API_KEY must be set (both
 * local .env and Render's environment variables) — never hardcoded here.
 */
async function reverseGeocode(lat, lng) {
  // No coordinates (location disabled/unavailable on the device) — nothing
  // to look up. Must not attempt a "null,null" request.
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return null;
  }

  const apiKey = process.env.LOCATIONIQ_API_KEY;
  if (!apiKey) {
    console.warn('[reverseGeocode] LOCATIONIQ_API_KEY is not set — skipping address resolution');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=en`;
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`[reverseGeocode] LocationIQ returned ${response.status} for (${lat}, ${lng})`);
      return null;
    }

    const data = await response.json();
    return data.display_name || null;
  } catch (err) {
    console.warn(`[reverseGeocode] failed for (${lat}, ${lng}): ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { reverseGeocode };
