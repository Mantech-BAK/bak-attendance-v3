const TIMEOUT_MS = 5000;

// Required by Nominatim's usage policy — unauthenticated requests without an
// identifying User-Agent get blocked. https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = 'bak-attendance-v3 (contact: mcs.sw01@bakgroup.net)';

/**
 * Real reverse geocoding via OpenStreetMap's Nominatim (free, no API key).
 * Called synchronously at punch-creation time. Must never block or fail the
 * punch itself — any error, timeout, or non-2xx response resolves to null
 * (logged server-side only) rather than throwing.
 */
async function reverseGeocode(lat, lng) {
  // No coordinates (location disabled/unavailable on the device) — nothing
  // to look up. Must not attempt a "null,null" request to Nominatim.
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[reverseGeocode] Nominatim returned ${response.status} for (${lat}, ${lng})`);
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
