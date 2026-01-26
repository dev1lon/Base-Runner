const { getOrCreateUser, updateUser } = require("./userRepo");

async function applyScore(address, score, coinsAwarded) {
  const user = await getOrCreateUser(address);
  const nextCoins = user.coins + coinsAwarded;
  const nextBest = Math.max(user.best_score, score);
  return updateUser(address, {
    coins: nextCoins,
    best_score: nextBest
  });
}

module.exports = {
  applyScore
};
