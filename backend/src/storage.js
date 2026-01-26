const crypto = require("crypto");

const sessions = new Map();
const users = new Map();

function createSession({ address, seed, ttlMs }) {
  const sessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  sessions.set(sessionId, {
    sessionId,
    address: address || null,
    seed,
    issuedAt,
    expiresAt,
    used: false
  });
  return sessions.get(sessionId);
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function markSessionUsed(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.used = true;
  }
  return session;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.used || session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

function getUser(address) {
  if (!address) return null;
  const key = address.toLowerCase();
  if (!users.has(key)) {
    users.set(key, { address: key, coinBalance: 0, bestScore: 0 });
  }
  return users.get(key);
}

function applyGameResult(address, score, coinsAwarded) {
  const user = getUser(address);
  if (!user) return null;
  user.coinBalance += coinsAwarded;
  if (score > user.bestScore) {
    user.bestScore = score;
  }
  return user;
}

module.exports = {
  createSession,
  getSession,
  markSessionUsed,
  cleanupSessions,
  getUser,
  applyGameResult
};
