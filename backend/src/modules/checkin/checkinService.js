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

/**
 * Read on-chain lastCheckin, retrying until it advances past `afterMs`.
 * The backend's RPC node can lag behind the wallet's node right after the
 * check-in tx confirms, so a single read may still return the stale value.
 * Without this, the reward gets silently skipped while the tx is real, which
 * leaves the user checked-in on-chain but with no coin credited.
 */
async function getFreshOnChainLastCheckin(address, afterMs) {
  let last = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await getOnChainLastCheckin(address);
    if (last > afterMs) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
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

  const user = await getOrCreateUser(address);
  const dbLastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;
  const now = Date.now();

  // Read on-chain lastCheckin, waiting for the backend RPC node to catch up
  // past the last recorded check-in. Without the retry the node may still
  // return the stale value right after the tx confirms, which would skip the
  // reward even though the on-chain check-in is real.
  const onChainMs = await getFreshOnChainLastCheckin(address, dbLastCheckinAt);
  if (onChainMs === 0) {
    return { ok: false, error: "On-chain check-in not found" };
  }

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
  const cooldownSec = Math.floor(CHECKIN_COOLDOWN_MS / 1000);

  // Atomic credit: increment coins (never overwrite) and only when the
  // cooldown has actually elapsed. The WHERE guard means two concurrent
  // submits can't both pass — the loser updates 0 rows.
  const updated = await query(
    `UPDATE users
     SET coins = coins + $2,
         streak = $3,
         checkin_count = checkin_count + 1,
         last_checkin_at = NOW(),
         updated_at = NOW()
     WHERE address = $1
       AND (last_checkin_at IS NULL OR last_checkin_at <= NOW() - make_interval(secs => $4))
     RETURNING streak, coins, checkin_count`,
    [address.toLowerCase(), reward, newStreak, cooldownSec]
  );

  if (!updated.rows[0]) {
    // Lost the race or cooldown not elapsed — already credited elsewhere.
    return { ok: false, error: "Already recorded this check-in" };
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
