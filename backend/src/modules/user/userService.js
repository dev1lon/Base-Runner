const { getOrCreateUser, updateUser } = require("./userRepo");

function applyScore(address, score, coinsAwarded) {
  const user = getOrCreateUser(address);
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
