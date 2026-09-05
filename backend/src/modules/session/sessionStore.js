const crypto = require('crypto');
const db = require('../../shared/db');

async function createSession({ address, seed, ttlMs, paid = false, characterId = 0, characterLevel = 0, boardWidth = 750, speedTesting = false, speedTestTier = 0 }, client = db) {
  const issuedAt = Date.now();
  const session = {sessionId: crypto.randomUUID(), address, seed, issuedAt, expiresAt: issuedAt + ttlMs,
    paid, characterId, characterLevel, boardWidth, speedTesting, speedTestTier, gameVersion: 2};
  await client.query('INSERT INTO game_sessions (session_id, address, state, expires_at) VALUES ($1, $2, $3, $4)',
    [session.sessionId, address, JSON.stringify(session), new Date(session.expiresAt)]);
  return session;
}

async function completeSession(sessionId, address, work) {
  return db.withTransaction(async client => {
    const {rows} = await client.query('SELECT address, state, result FROM game_sessions WHERE session_id = $1 FOR UPDATE', [sessionId]);
    if (!rows.length) throw new Error('Unknown session');
    const row = rows[0];
    if (row.address !== address) throw new Error('Session address mismatch');
    if (row.result) return row.result;
    if (row.state.expiresAt <= Date.now()) throw new Error('Session expired');
    const result = await work(row.state, client);
    await client.query('UPDATE game_sessions SET result = $2 WHERE session_id = $1', [sessionId, JSON.stringify(result)]);
    return result;
  });
}

async function cleanupSessions() {
  await db.query("DELETE FROM game_sessions WHERE expires_at < NOW() - INTERVAL '1 day'");
}

module.exports = { createSession, completeSession, cleanupSessions };
