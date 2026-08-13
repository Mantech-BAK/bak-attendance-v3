const crypto = require('crypto');
const pool = require('../db');

/**
 * STUB matching strategy — NOT real face recognition.
 *
 * There is no face-embedding/recognition engine wired up yet. This compares
 * the uploaded image's exact byte hash against each stored template's byte
 * hash, so it only matches when the identical image file is resubmitted
 * (e.g. re-uploading the same registration photo in a test). A live camera
 * capture will essentially never byte-match a prior registration photo.
 *
 * Replace with a real face-matching engine (embeddings + cosine-similarity
 * threshold, or a hosted API like AWS Rekognition CompareFaces / Azure Face)
 * before this is used with real camera captures.
 */

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashDataUri(dataUri) {
  const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  return hashBuffer(Buffer.from(base64, 'base64'));
}

async function matchFace(imageBuffer) {
  const uploadedHash = hashBuffer(imageBuffer);

  const { rows } = await pool.query(
    'SELECT "EmpId" AS emp_id, "EmpFaceId" AS face_template FROM employees WHERE "EmpFaceId" IS NOT NULL'
  );

  const match = rows.find((row) => hashDataUri(row.face_template) === uploadedHash);
  return match ? match.emp_id : null;
}

module.exports = { matchFace };
