const { ethers } = require("ethers");
const { query } = require("../../shared/db");
const { getOrCreateUser } = require("../user/userRepo");

const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;    // 24 hours (same as contract)
// Streak continues if next check-in within 24h + 12h of next day = 36h
const STREAK_TIMEOUT_MS   = 36 * 60 * 60 * 1000;
const BASE_REWARD         = 1;
const STREAK_BONUS_EVERY  = 5;
const STREAK_BONUS_AMOUNT = 1;
const VERIFY_WINDOW_MS    = 10 * 60 * 1000;          // on-chain tx must be within 10 min

const NFT_ABI = [
  "function lastCheckin(address) view returns (uint256)",
  "function canCheckIn(address) view returns (bool)"
];

function getContract() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://sepolia.base.org");
  return new ethers.Contract(process.env.NFT_CONTRACT_ADDRESS, NFT_ABI, provider);
}

function calcReward(streak) {
  return streak % STREAK_BONUS_EVERY === 0 ? BASE_REWARD + STREAK_BONUS_AMOUNT : BASE_REWARD;
}

async function getCheckinStatus(address) {
  const user = await getOrCreateUser(address);
  const lastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;
  const now = Date.now();

  const canCheckin = lastCheckinAt === 0 || now >= lastCheckinAt + CHECKIN_COOLDOWN_MS;

  let nextStreak;
  if (lastCheckinAt === 0 || now > lastCheckinAt + STREAK_TIMEOUT_MS) {
    nextStreak = 1;
  } else {
    nextStreak = (user.streak || 0) + 1;
  }

  return {
    lastCheckin: lastCheckinAt,
    streak: user.streak || 0,
    checkinCount: user.checkin_count || 0,
    canCheckin,
    nextReward: calcReward(nextStreak)
  };
}

/**
 * Verify on-chain check-in and update streak/coins on backend.
 * @param {string} address - user wallet
 * @param {string} txHash  - TX hash from contract.checkIn()
 */
async function doCheckin(address, txHash) {
  if (!txHash) return { ok: false, error: "txHash required" };

  // Verify on-chain: lastCheckin must be updated within last 10 min
  try {
    const contract = getContract();
    const onChainTs = await contract.lastCheckin(address);
    const onChainMs = Number(onChainTs) * 1000;
    const now = Date.now();

    if (onChainMs === 0 || now - onChainMs > VERIFY_WINDOW_MS) {
      return { ok: false, error: "On-chain check-in not found or too old" };
    }
  } catch (e) {
    console.error("Contract verify failed:", e.message);
    return { ok: false, error: "Failed to verify on-chain check-in" };
  }

  const user = await getOrCreateUser(address);
  const lastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;
  const now = Date.now();

  if (lastCheckinAt > 0 && now < lastCheckinAt + CHECKIN_COOLDOWN_MS) {
    const msLeft = lastCheckinAt + CHECKIN_COOLDOWN_MS - now;
    return { ok: false, error: "Too early", msUntilNext: msLeft };
  }

  let newStreak;
  if (lastCheckinAt === 0 || now > lastCheckinAt + STREAK_TIMEOUT_MS) {
    newStreak = 1;
  } else {
    newStreak = (user.streak || 0) + 1;
  }

  const reward = calcReward(newStreak);
  const newCoins = (user.coins || 0) + reward;
  const newCount = (user.checkin_count || 0) + 1;

  await query(
    `UPDATE users
     SET coins = $1, streak = $2, checkin_count = $3, last_checkin_at = NOW(), updated_at = NOW()
     WHERE address = $4`,
    [newCoins, newStreak, newCount, address.toLowerCase()]
  );

  return {
    ok: true,
    streak: newStreak,
    reward,
    newBalance: newCoins,
    checkinCount: newCount
  };
}

module.exports = { getCheckinStatus, doCheckin };
