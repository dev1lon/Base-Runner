const { getOrCreateUser, applyRunResult } = require("./userRepo");

/**
 * Apply score and award coins (DB only, no blockchain).
 * Uses an atomic increment so concurrent submits can't lose a coin award.
 */
async function applyScore(address, score, coinsAwarded) {
  await getOrCreateUser(address); // ensure row exists
  return applyRunResult(address, score, coinsAwarded);
}

module.exports = { applyScore };
