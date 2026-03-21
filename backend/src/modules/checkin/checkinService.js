const { query } = require("../../shared/db");
const { getOrCreateUser, updateUser } = require("../user/userRepo");

const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;   // 24 hours
const STREAK_TIMEOUT_MS  = 36 * 60 * 60 * 1000;   // 36 hours — miss this and streak resets
const BASE_REWARD        = 1;
const STREAK_BONUS_EVERY = 5;
const STREAK_BONUS_AMOUNT = 1;

function calcReward(streak) {
  return streak % STREAK_BONUS_EVERY === 0 ? BASE_REWARD + STREAK_BONUS_AMOUNT : BASE_REWARD;
}

/**
 * Get check-in status for a user
 */
async function getCheckinStatus(address) {
  const user = await getOrCreateUser(address);
  const lastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;
  const now = Date.now();

  const canCheckin = lastCheckinAt === 0 || now >= lastCheckinAt + CHECKIN_COOLDOWN_MS;

  // Preview next streak/reward
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
 * Perform check-in — awards coins, updates streak
 */
async function doCheckin(address) {
  const user = await getOrCreateUser(address);
  const lastCheckinAt = user.last_checkin_at ? new Date(user.last_checkin_at).getTime() : 0;
  const now = Date.now();

  if (lastCheckinAt > 0 && now < lastCheckinAt + CHECKIN_COOLDOWN_MS) {
    const msLeft = lastCheckinAt + CHECKIN_COOLDOWN_MS - now;
    return { ok: false, error: "Too early", msUntilNext: msLeft };
  }

  // Calculate new streak
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
