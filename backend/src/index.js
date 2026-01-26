require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { verifyMessage } = require("ethers");
const { simulateRun, DEFAULT_CONFIG } = require("./sim");
const {
  createSession,
  getSession,
  markSessionUsed,
  cleanupSessions,
  getUser,
  applyGameResult
} = require("./storage");

const app = express();

const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 10 * 60 * 1000);
const MAX_DURATION_MS = Number(process.env.MAX_DURATION_MS || 5 * 60 * 1000);
const REQUIRE_SIGNATURE = String(process.env.REQUIRE_SIGNATURE || "false").toLowerCase() === "true";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function buildSignMessage(sessionId) {
  return `BaseApp Runner session ${sessionId}`;
}

function randomSeed() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizeAddress(address) {
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/api/session/start", (req, res) => {
  const { address } = req.body || {};
  const seed = randomSeed();
  const session = createSession({
    address: normalizeAddress(address),
    seed,
    ttlMs: SESSION_TTL_MS
  });
  res.json({
    sessionId: session.sessionId,
    seed: session.seed,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    signMessage: buildSignMessage(session.sessionId),
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

app.post("/api/session/submit", async (req, res) => {
  const {
    sessionId,
    address,
    durationMs,
    inputLog,
    reportedScore,
    signature
  } = req.body || {};

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

  const addressNorm = normalizeAddress(address || session.address);
  if (!addressNorm) {
    res.status(400).json({ ok: false, error: "Missing address" });
    return;
  }

  if (REQUIRE_SIGNATURE) {
    if (!signature) {
      res.status(400).json({ ok: false, error: "Missing signature" });
      return;
    }
    try {
      const recovered = verifyMessage(buildSignMessage(sessionId), signature);
      if (normalizeAddress(recovered) !== addressNorm) {
        res.status(400).json({ ok: false, error: "Signature mismatch" });
        return;
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: "Invalid signature" });
      return;
    }
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
  const user = applyGameResult(addressNorm, finalScore, coinsAwarded);
  markSessionUsed(sessionId);

  res.json({
    ok: true,
    simScore,
    finalScore,
    maxScore,
    coinsAwarded,
    coinBalance: user ? user.coinBalance : 0,
    bestScore: user ? user.bestScore : finalScore,
    collidedAtMs: simResult.collidedAtMs
  });
});

app.get("/api/user/:address", (req, res) => {
  const addressNorm = normalizeAddress(req.params.address);
  if (!addressNorm) {
    res.status(400).json({ ok: false, error: "Invalid address" });
    return;
  }
  const user = getUser(addressNorm);
  res.json({
    ok: true,
    address: user.address,
    coinBalance: user.coinBalance,
    bestScore: user.bestScore
  });
});

setInterval(cleanupSessions, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
});
