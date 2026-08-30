const pool = require('../db');

// Real on-device face matching support. The actual embedding computation
// (MobileFaceNet via react-native-fast-tflite) happens client-side on the
// phone — this service only stores/compares the resulting 192-dim vectors.
// EmpFaceId stores JSON: { v: 1, embeddings: number[][] } — one entry per
// registered angle (3-4 per employee). This is a format change from the old
// single-base64-image stub (services/faceMatch.js's previous matchFace),
// which is why registration requires EmpFaceId to be empty first rather
// than trying to migrate old data — confirmed empty on both DBs before this
// change shipped.
const EMBEDDING_LENGTH = 192;
const MATCH_THRESHOLD = 0.75;

function isValidEmbedding(embedding) {
  return (
    Array.isArray(embedding) &&
    embedding.length === EMBEDDING_LENGTH &&
    embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

function l2Normalize(embedding) {
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return embedding;
  return embedding.map((v) => v / norm);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function parseStoredEmbeddings(faceIdJson) {
  try {
    const parsed = JSON.parse(faceIdJson);
    if (!parsed || !Array.isArray(parsed.embeddings)) return [];
    return parsed.embeddings.filter(isValidEmbedding).map(l2Normalize);
  } catch {
    return [];
  }
}

/**
 * 1:N open identification (confirmed design — no claimed emp_id, the
 * submitted embedding is compared against every active, face-registered
 * employee's stored embeddings). Returns the best-matching emp_id, or null
 * if nothing clears MATCH_THRESHOLD.
 */
async function identifyByFace(liveEmbedding) {
  if (!isValidEmbedding(liveEmbedding)) return null;
  const normalizedLive = l2Normalize(liveEmbedding);

  const { rows } = await pool.query(
    `SELECT "EmpId" AS emp_id, "EmpFaceId" AS face_data
     FROM employees
     WHERE "EmpStatus" = 'active' AND "EmpFaceId" IS NOT NULL`
  );

  let bestEmpId = null;
  let bestScore = -Infinity;

  for (const row of rows) {
    const storedEmbeddings = parseStoredEmbeddings(row.face_data);
    for (const stored of storedEmbeddings) {
      const score = cosineSimilarity(normalizedLive, stored);
      if (score > bestScore) {
        bestScore = score;
        bestEmpId = row.emp_id;
      }
    }
  }

  return bestScore >= MATCH_THRESHOLD ? bestEmpId : null;
}

module.exports = { identifyByFace, isValidEmbedding, EMBEDDING_LENGTH, MATCH_THRESHOLD };
