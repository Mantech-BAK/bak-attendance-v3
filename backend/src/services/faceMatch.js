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
 * TEMPORARY diagnostic instrumentation (2026-09-10) — investigating reports
 * of frequent (not just borderline) Face ID misses. Logs every attempt's
 * full per-embedding score breakdown to face_identify_log so real match-
 * score data can be inspected directly, rather than guessing between "the
 * threshold is too tight" vs "something is systematically wrong with
 * capture/preprocessing". Never allowed to affect the actual identify
 * result — wrapped so a logging failure can't break real identification.
 * Safe to remove this table/call once the investigation concludes.
 */
async function logIdentifyAttempt({ breakdown, bestEmpId, bestScore, matched, candidateCount }) {
  try {
    await pool.query(
      `INSERT INTO face_identify_log (matched_emp_id, best_score, matched, threshold, candidate_count, score_breakdown)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [matched ? bestEmpId : null, Number.isFinite(bestScore) ? bestScore : null, matched, MATCH_THRESHOLD, candidateCount, JSON.stringify(breakdown)]
    );
  } catch (err) {
    console.error('[face-identify] failed to log attempt (non-fatal):', err.message);
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
  // Per-candidate, per-registered-embedding scores — lets us see whether
  // ALL angles for the true match score consistently, or whether one bad
  // registered angle is dragging the best-of-N down (or up) unexpectedly.
  const breakdown = [];

  for (const row of rows) {
    const storedEmbeddings = parseStoredEmbeddings(row.face_data);
    const scores = storedEmbeddings.map((stored) => cosineSimilarity(normalizedLive, stored));
    breakdown.push({ emp_id: row.emp_id, embedding_count: storedEmbeddings.length, scores });

    for (const score of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestEmpId = row.emp_id;
      }
    }
  }

  const matched = bestScore >= MATCH_THRESHOLD;
  console.log(
    `[face-identify] best=${bestEmpId ?? 'none'} score=${Number.isFinite(bestScore) ? bestScore.toFixed(4) : 'n/a'} ` +
    `threshold=${MATCH_THRESHOLD} matched=${matched} candidates=${rows.length}`
  );
  await logIdentifyAttempt({ breakdown, bestEmpId, bestScore, matched, candidateCount: rows.length });

  return matched ? bestEmpId : null;
}

module.exports = { identifyByFace, isValidEmbedding, EMBEDDING_LENGTH, MATCH_THRESHOLD };
