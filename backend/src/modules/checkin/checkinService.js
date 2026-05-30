const { ethers } = require("ethers");
const { query } = require("../../shared/db");
const { getOrCreateUser } = require("../user/userRepo");

const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_TIMEOUT_MS   = 36 * 60 * 60 * 1000;
const BASE_REWARD         = 1;
const STREAK_BONUS_EVERY  = 5;
const STREAK_BONUS_AMOUNT = 1;

const NFT_ABI = [
  "function lastCheckin(address) view returns (uint256)",
  "function canCheckIn(address) view returns (bool)"
];

let readProvider;
let readContract;

function getContract() {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider("https://mainnet.base.org");
  }
  if (!readContract) {
    readContract = new ethers.Contract(process.env.NFT_CONTRACT_ADDRESS, NFT_ABI, readProvider);
  }
  return readContract;
}

function calcReward(streak) {
  return streak % STREAK_BONUS_EVERY === 0 ? BASE_REWARD + STREAK_BONUS_AMOUNT : BASE_REWARD;
}

/**
 * Read on-chain lastCheckin timestamp (ms). Returns 0 on failure.
 */
async function getOnChainLastCheckin(address) {
  try {
    const contract = getContract();
    const ts = await contract.lastCheckin(address);
    return Number(ts) * 1000;
  } catch (e) {
    console.warn("Failed to read lastCheckin from contract:", e.message);
    return 0;
  }
}

async function getCheckinStatus(address) {
  const user = await getOrCreateUser(address);
  const dbLastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;

  // Contract is source of truth for cooldown
  const onChainLastCheckinMs = await getOnChainLastCheckin(address);
  const lastCheckinAt = Math.max(onChainLastCheckinMs, dbLastCheckinAt);

  const now = Date.now();
  const canCheckin = lastCheckinAt === 0 || now >= lastCheckinAt + CHECKIN_COOLDOWN_MS;
  const streakActive = lastCheckinAt > 0 && now <= lastCheckinAt + STREAK_TIMEOUT_MS;

  let nextStreak;
  if (!streakActive) {
    nextStreak = 1;
  } else {
    nextStreak = (user.streak || 0) + 1;
  }

  return {
    lastCheckin: lastCheckinAt,
    streak: streakActive ? (user.streak || 0) : 0,
    checkinCount: user.checkin_count || 0,
    canCheckin,
    nextReward: calcReward(nextStreak)
  };
}

/**
 * Verify on-chain check-in and update streak/coins on backend.
 * Uses on-chain lastCheckin as source of truth — no time window restriction.
 */
async function doCheckin(address, txHash) {
  if (!txHash) return { ok: false, error: "txHash required" };

  const onChainMs = await getOnChainLastCheckin(address);
  if (onChainMs === 0) {
    return { ok: false, error: "On-chain check-in not found" };
  }

  const user = await getOrCreateUser(address);
  const dbLastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;
  const now = Date.now();

  // Don't reward twice for the same on-chain check-in
  if (dbLastCheckinAt > 0 && onChainMs <= dbLastCheckinAt) {
    return { ok: false, error: "Already recorded this check-in" };
  }

  // Cooldown check against DB (prevents re-submitting old on-chain TX)
  if (dbLastCheckinAt > 0 && now < dbLastCheckinAt + CHECKIN_COOLDOWN_MS) {
    const msLeft = dbLastCheckinAt + CHECKIN_COOLDOWN_MS - now;
    return { ok: false, error: "Too early", msUntilNext: msLeft };
  }

  let newStreak;
  if (dbLastCheckinAt === 0 || now > dbLastCheckinAt + STREAK_TIMEOUT_MS) {
    newStreak = 1;
  } else {
    newStreak = (user.streak || 0) + 1;
  }

  const reward = calcReward(newStreak);
  const newCoins = (user.coins || 0) + reward;
  const newCount = (user.checkin_count || 0) + 1;

  const updated = await query(
    `UPDATE users
     SET coins = $1, streak = $2, checkin_count = $3, last_checkin_at = NOW(), updated_at = NOW()
     WHERE address = $4
     RETURNING streak, coins, checkin_count`,
    [newCoins, newStreak, newCount, address.toLowerCase()]
  );

  if (!updated.rows[0]) {
    // No row matched — try upsert with correct lowercase key
    const upserted = await query(
      `INSERT INTO users (address, coins, streak, checkin_count, last_checkin_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (address) DO UPDATE
       SET coins = EXCLUDED.coins, streak = EXCLUDED.streak,
           checkin_count = EXCLUDED.checkin_count, last_checkin_at = NOW(), updated_at = NOW()
       RETURNING streak, coins, checkin_count`,
      [address.toLowerCase(), newCoins, newStreak, newCount]
    );
    const saved = upserted.rows[0];
    return { ok: true, streak: saved ? saved.streak : newStreak, reward, newBalance: saved ? saved.coins : newCoins, checkinCount: saved ? saved.checkin_count : newCount };
  }

  const saved = updated.rows[0];
  return {
    ok: true,
    streak: saved.streak,
    reward,
    newBalance: saved.coins,
    checkinCount: saved.checkin_count
  };
}

module.exports = { getCheckinStatus, doCheckin };
