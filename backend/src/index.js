require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { simulateRun, DEFAULT_CONFIG } = require("./sim");
const {
  createSession,
  getSession,
  markSessionUsed,
  cleanupSessions
} = require("./modules/session/sessionStore");
const { getOrCreateUser } = require("./modules/user/userRepo");
const { applyScore } = require("./modules/user/userService");
const { startCheckin, submitCheckin } = require("./modules/checkin/checkinService");
const { ensureSchema } = require("./shared/db");
const { normalizeAddress, verifyJwt } = require("./shared/auth");
const { issueNonce, verifyNonce } = require("./modules/auth/authService");

const app = express();

const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 10 * 60 * 1000);
const MAX_DURATION_MS = Number(process.env.MAX_DURATION_MS || 5 * 60 * 1000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function randomSeed() {
  return `seed-${Math.random().toString(16).slice(2)}`;
}

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: "Missing token" });
    return;
  }
  try {
    const payload = verifyJwt(token);
    const addressNorm = normalizeAddress(payload.address);
    if (!addressNorm) {
      res.status(401).json({ ok: false, error: "Invalid token" });
      return;
    }
    req.user = { address: addressNorm };
    next();
  } catch (err) {
    res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

app.post("/auth/nonce", async (req, res) => {
  const { address, chainId } = req.body || {};
  const addressNorm = normalizeAddress(address);
  if (!addressNorm || !chainId) {
    res.status(400).json({ ok: false, error: "Invalid address" });
    return;
  }
  const result = await issueNonce(addressNorm, String(chainId));
  res.json({ ok: true, nonce: result.nonce, issuedAt: result.issuedAt });
});

app.post("/auth/verify", async (req, res) => {
  const { address, signature } = req.body || {};
  const addressNorm = normalizeAddress(address);
  if (!addressNorm || !signature) {
    res.status(400).json({ ok: false, error: "Invalid address" });
    return;
  }
  const result = await verifyNonce({ address: addressNorm, signature });
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({
    ok: true,
    token: result.token,
    address: result.user.address,
    coinBalance: result.user.coins,
    bestScore: result.user.best_score,
    streak: result.user.streak,
    lastCheckin: result.user.last_checkin
  });
});

app.post("/api/session/start", requireAuth, (req, res) => {
  const addressNorm = req.user.address;
  const seed = randomSeed();
  const session = createSession({
    address: addressNorm,
    seed,
    ttlMs: SESSION_TTL_MS
  });
  res.json({
    sessionId: session.sessionId,
    seed: session.seed,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    config: {
      frameMs: DEFAULT_CONFIG.frameMs,
      speedStart: DEFAULT_CONFIG.speedStart,
      speedMax: DEFAULT_CONFIG.speedMax,
      speedMaxScore: DEFAULT_CONFIG.speedMaxScore,
      gravity: DEFAULT_CONFIG.gravity,
      jumpVelocity: DEFAULT_CONFIG.jumpVelocity
    }
  });
});

app.post("/api/session/submit", requireAuth, async (req, res) => {
  const { sessionId, inputLog, reportedScore } = req.body || {};

  if (!sessionId) {
    res.status(400).json({ ok: false, error: "Missing sessionId" });
    return;
  }
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ ok: false, error: "Unknown session" });
    return;
  }
  if (session.used) {
    res.status(400).json({ ok: false, error: "Session already used" });
    return;
  }
  if (session.expiresAt <= Date.now()) {
    res.status(400).json({ ok: false, error: "Session expired" });
    return;
  }

  const addressNorm = req.user.address;
  if (!addressNorm || addressNorm !== session.address) {
    res.status(403).json({ ok: false, error: "Session address mismatch" });
    return;
  }

  const serverDurationMs = Math.min(Date.now() - session.issuedAt, MAX_DURATION_MS);
  if (!Number.isFinite(serverDurationMs) || serverDurationMs <= 0) {
    res.status(400).json({ ok: false, error: "Invalid duration" });
    return;
  }

  const simResult = simulateRun({
    seed: session.seed,
    durationMs: serverDurationMs,
    inputEvents: inputLog
  });

  const simScore = simResult.score;
  const reported = Number.isFinite(Number(reportedScore))
    ? Number(reportedScore)
    : null;
  const tolerance = 2;
  const maxScore = Math.floor(serverDurationMs / DEFAULT_CONFIG.frameMs) + tolerance;

  if (reported === null) {
    res.status(400).json({ ok: false, error: "Missing reportedScore" });
    return;
  }

  if (reported > maxScore) {
    res.status(403).json({
      ok: false,
      error: "Score exceeds time limit",
      maxScore
    });
    return;
  }

  const finalScore = Math.min(reported, maxScore);
  const coinsAwarded = Math.floor(finalScore / 10000);
  const user = await applyScore(addressNorm, finalScore, coinsAwarded);
  markSessionUsed(sessionId);

  res.json({
    ok: true,
    simScore,
    finalScore,
    maxScore,
    coinsAwarded,
    coinBalance: user ? user.coins : 0,
    bestScore: user ? user.best_score : finalScore,
    collidedAtMs: simResult.collidedAtMs
  });
});

app.get("/api/user/me", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.user.address);
  res.json({
    ok: true,
    address: user.address,
    coinBalance: user.coins,
    bestScore: user.best_score,
    streak: user.streak,
    lastCheckin: user.last_checkin
  });
});

app.post("/api/checkin/start", requireAuth, async (req, res) => {
  const result = await startCheckin(req.user.address);
  res.json({
    ok: true,
    alreadyCheckedIn: result.alreadyCheckedIn,
    message: result.message,
    nonce: result.nonce,
    coinBalance: result.user.coins,
    streak: result.user.streak,
    lastCheckin: result.user.last_checkin
  });
});

app.post("/api/checkin/submit", requireAuth, async (req, res) => {
  const { signature } = req.body || {};
  if (!signature) {
    res.status(400).json({ ok: false, error: "Missing signature" });
    return;
  }
  const result = await submitCheckin(req.user.address, signature);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({
    ok: true,
    alreadyCheckedIn: result.alreadyCheckedIn,
    coinsAwarded: result.coinsAwarded,
    bonusAwarded: result.bonusAwarded,
    coinBalance: result.user.coins,
    streak: result.user.streak,
    lastCheckin: result.user.last_checkin
  });
});

setInterval(cleanupSessions, 60 * 1000);

async function startServer() {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`Backend listening on :${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start backend", err);
    process.exit(1);
  }
}

startServer();
