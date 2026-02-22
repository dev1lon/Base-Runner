const { getOrCreateUser, updateUser } = require("./userRepo");
const { mintCoins, getOnChainBalance, isBlockchainReady } = require("../../shared/blockchain");

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
  
  // Sync DB coins from blockchain before awarding (check-ins add on-chain only)
  if (isBlockchainReady()) {
    try {
      const onChainBefore = await getOnChainBalance(address);
      const onChainCoins = Math.floor(onChainBefore);
      if (onChainCoins > user.coins) {
        console.log(`📡 Syncing DB coins from chain: ${user.coins} → ${onChainCoins}`);
        user.coins = onChainCoins;
      }
    } catch (e) {
      console.warn("Failed to sync on-chain balance before award:", e.message);
    }
  }
  
  // Try to mint on-chain if coins were earned
  if (coinsAwarded > 0 && isBlockchainReady()) {
    console.log(`Attempting to mint ${coinsAwarded} coins on-chain to ${address}`);
    
    mintResult = await mintCoins(address, coinsAwarded);
    
    if (mintResult.success) {
      onChainMinted = coinsAwarded;
      console.log(`✅ On-chain mint successful: ${mintResult.txHash}`);
    } else {
      console.warn(`⚠️ On-chain mint failed: ${mintResult.error}. Crediting in DB only.`);
    }
  }
  
  const nextCoins = user.coins + coinsAwarded;
  const updatedUser = await updateUser(address, {
    coins: nextCoins,
    best_score: nextBest
  });
  
  return {
    ...updatedUser,
    mintResult,
    onChainMinted
  };
}

module.exports = {
  applyScore
};
