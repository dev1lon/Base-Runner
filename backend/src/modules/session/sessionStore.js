const crypto = require("crypto");

const sessions = new Map();

function createSession({ address, seed, ttlMs, paid = false }) {
  const sessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const session = {
    sessionId,
    address: address || null,
    seed,
    issuedAt,
    expiresAt,
    used: false,
    paid
  };
  sessions.set(sessionId, session);
  return session;
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

module.exports = {
  createSession,
  getSession,
  markSessionUsed,
  cleanupSessions
};
