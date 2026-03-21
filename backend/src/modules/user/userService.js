const { getOrCreateUser, updateUser } = require("./userRepo");

/**
 * Apply score and award coins (DB only, no blockchain)
 */
async function applyScore(address, score, coinsAwarded) {
  const user = await getOrCreateUser(address);
  const nextBest = Math.max(user.best_score, score);
  const nextCoins = user.coins + coinsAwarded;

  const updatedUser = await updateUser(address, {
    coins: nextCoins,
    best_score: nextBest
  });

  return updatedUser;
}

module.exports = { applyScore };
