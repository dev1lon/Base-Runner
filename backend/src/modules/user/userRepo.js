const { getUserRecord, setUserRecord } = require("../../shared/db");

function getUser(address) {
  return getUserRecord(address);
}

function createUser(address) {
  const now = new Date().toISOString();
  const user = {
    address,
    coins: 0,
    best_score: 0,
    streak: 0,
    last_checkin: null,
    checkin_nonce: null,
    created_at: now,
    updated_at: now
  };
  return setUserRecord(address, user);
}

function getOrCreateUser(address) {
  const existing = getUser(address);
  if (existing) return existing;
  return createUser(address);
}

function updateUser(address, updates) {
  const user = getOrCreateUser(address);
  const next = { ...user, ...updates, updated_at: new Date().toISOString() };
  return setUserRecord(address, next);
}

module.exports = {
  getUser,
  getOrCreateUser,
  updateUser
};
