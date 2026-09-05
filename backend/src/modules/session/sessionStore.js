const crypto = require("crypto");

const sessions = new Map();

function createSession({ address, seed, ttlMs, paid = false, characterId = 0, characterLevel = 0 }) {
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
    paid,
    characterId,
    characterLevel,
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

// Atomically claim a session: returns true only if it was unused and we just
// flipped it to used. Node runs this synchronously with no await inside, so two
// concurrent submits can't both win — the second sees used=true and gets false.
function claimSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.used) return false;
  session.used = true;
  return true;
}

// Release a claim (e.g. when the score write failed) so the player can retry.
function releaseSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.used = false;
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
  claimSession,
  releaseSession,
  cleanupSessions
};
