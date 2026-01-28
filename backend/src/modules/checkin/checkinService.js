const { getOrCreateUser, updateUser } = require("../user/userRepo");
const { getDateKey, isToday, isYesterday } = require("../../shared/dates");
const { createNonce } = require("../../shared/nonce");

async function startCheckin(address) {
  const user = await getOrCreateUser(address);
  if (isToday(user.last_checkin)) {
    return {
      alreadyCheckedIn: true,
      message: null,
      nonce: null,
      user
    };
  }
  const nonce = createNonce();
  const updated = await updateUser(address, { checkin_nonce: nonce });
  return {
    alreadyCheckedIn: false,
    message: `Check-in nonce: ${nonce}`, // Still return message for compatibility
    nonce,
    user: updated
  };
}

async function submitCheckin(address, txHash) {
  const user = await getOrCreateUser(address);
  if (!user.checkin_nonce) {
    return { ok: false, error: "No checkin nonce - call /checkin/start first" };
  }
  // txHash is proof of on-chain transaction (user already authenticated via JWT)
  if (!txHash || typeof txHash !== "string" || txHash.length < 10) {
    return { ok: false, error: "Invalid or missing txHash" };
  }
  if (isToday(user.last_checkin)) {
    const cleared = await updateUser(address, { checkin_nonce: null });
    return {
      ok: true,
      alreadyCheckedIn: true,
      coinsAwarded: 0,
      bonusAwarded: 0,
      user: cleared
    };
  }

  const nextStreak = isYesterday(user.last_checkin) ? user.streak + 1 : 1;
  const bonusAwarded = nextStreak % 5 === 0 ? 1 : 0;
  const coinsAwarded = 1 + bonusAwarded;
  const updated = await updateUser(address, {
    coins: user.coins + coinsAwarded,
    streak: nextStreak,
    last_checkin: getDateKey(),
    checkin_nonce: null
  });

  return {
    ok: true,
    alreadyCheckedIn: false,
    coinsAwarded,
    bonusAwarded,
    user: updated
  };
}

module.exports = {
  startCheckin,
  submitCheckin
};
