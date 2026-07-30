const pool = require('../db');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_LENGTH = 5;
const MAX_ATTEMPTS = 20;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }
  return code;
}

// Generates a random 5-letter login_code guaranteed not to collide with an
// existing employee's code. Retries on the rare random collision instead of
// pre-loading the full existing set, since the code space (26^5 ≈ 11.9M) is
// large relative to headcount. Accepts an optional query executor (e.g. a
// transaction client) so callers looping within a single transaction see
// codes assigned earlier in that same transaction.
async function generateUniqueLoginCode(queryable = pool) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomCode();
    const { rows } = await queryable.query('SELECT 1 FROM employees WHERE login_code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error(`Could not generate a unique login_code after ${MAX_ATTEMPTS} attempts`);
}

module.exports = { generateUniqueLoginCode };
