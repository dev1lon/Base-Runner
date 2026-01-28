const { getOrCreateUser, updateUser } = require("./userRepo");
const { mintCoins, isBlockchainReady } = require("../../shared/blockchain");

/**
 * Apply score and award coins (with on-chain minting)
 * @param {string} address - User wallet address
 * @param {number} score - Final validated score
 * @param {number} coinsAwarded - Coins to award (from milestones)
 * @returns {Promise<{user: object, mintResult?: object}>}
 */
async function applyScore(address, score, coinsAwarded) {
  const user = await getOrCreateUser(address);
  const nextBest = Math.max(user.best_score, score);
  
  let mintResult = null;
  let onChainMinted = 0;
  
  // Try to mint on-chain if coins were earned
  if (coinsAwarded > 0 && isBlockchainReady()) {
    console.log(`Attempting to mint ${coinsAwarded} coins on-chain to ${address}`);
    
    mintResult = await mintCoins(address, coinsAwarded);
    
    if (mintResult.success) {
      onChainMinted = coinsAwarded;
      console.log(`✅ On-chain mint successful: ${mintResult.txHash}`);
    } else {
      // On-chain mint failed - still credit in DB as fallback
      console.warn(`⚠️ On-chain mint failed: ${mintResult.error}. Crediting in DB only.`);
    }
  }
  
  // Always update DB (coins in DB for display, even if on-chain mint failed)
  const nextCoins = user.coins + coinsAwarded;
  const updatedUser = await updateUser(address, {
    coins: nextCoins,
    best_score: nextBest
  });
  
  // Return both user data and mint result
  return {
    ...updatedUser,
    mintResult,
    onChainMinted
  };
}

module.exports = {
  applyScore
};
