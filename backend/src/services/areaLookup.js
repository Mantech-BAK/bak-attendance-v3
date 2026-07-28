const pool = require('../db');

const EARTH_RADIUS_KM = 6371;
const MAX_MATCH_DISTANCE_KM = 15;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// Great-circle distance between two lat/lng points, in kilometers.
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Rough nearest-area match for a punch's lat/lng — not real reverse
 * geocoding. Returns the closest seeded bahrain_areas name, or null if
 * every seeded area is farther than MAX_MATCH_DISTANCE_KM (a clearly
 * wrong nearest match is worse than no match at all).
 */
async function resolveArea(lat, lng) {
  const { rows } = await pool.query('SELECT area_name, center_lat, center_lng FROM bahrain_areas');

  let closest = null;
  let closestDistance = Infinity;

  for (const area of rows) {
    const distance = haversineDistanceKm(lat, lng, area.center_lat, area.center_lng);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = area.area_name;
    }
  }

  return closestDistance <= MAX_MATCH_DISTANCE_KM ? closest : null;
}

module.exports = { resolveArea, haversineDistanceKm, MAX_MATCH_DISTANCE_KM };
