const { getOrCreateUser, updateUser } = require("../user/userRepo");
const { getDateKey, isToday, isYesterday } = require("../../shared/dates");
const { createNonce } = require("../../shared/nonce");
const { buildCheckinMessage } = require("../../shared/messages");
const { verifySignature } = require("../../shared/auth");

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
  const message = buildCheckinMessage(nonce);
  const updated = await updateUser(address, { checkin_nonce: nonce });
  return {
    alreadyCheckedIn: false,
    message,
    nonce,
    user: updated
  };
}

async function submitCheckin(address, signature) {
  const user = await getOrCreateUser(address);
  if (!user.checkin_nonce) {
    return { ok: false, error: "No checkin nonce" };
  }
  const message = buildCheckinMessage(user.checkin_nonce);
  if (!verifySignature(address, message, signature)) {
    return { ok: false, error: "Invalid signature" };
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
