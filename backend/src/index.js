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
const {
  getCharacters,
  getCharacter,
  addCharacter,
  startPurchase,
  confirmPurchase,
  cancelPurchase,
  getAvailableCoins,
  getUserInventory
} = require("./modules/shop/shopService");
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
    bestScore: result.user.best_score
    // streak and lastCheckin now read from blockchain
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
  const { sessionId, inputLog, reportedScore, gameElapsedMs } = req.body || {};

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
    console.log("❌ 403: Session address mismatch", { addressNorm, sessionAddress: session.address });
    res.status(403).json({ ok: false, error: "Session address mismatch" });
    return;
  }

  // Calculate duration - prefer client-reported gameElapsedMs, fallback to server time
  const serverDurationMs = Math.min(Date.now() - session.issuedAt, MAX_DURATION_MS);
  const clientElapsedMs = Number.isFinite(Number(gameElapsedMs)) ? Number(gameElapsedMs) : 0;
  
  // Get last input time as sanity check
  const inputLogArray = Array.isArray(inputLog) ? inputLog : [];
  const lastInputTime = inputLogArray.reduce((max, ev) => {
    const t = Number(ev?.t);
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  
  // Use client elapsed time if reasonable, otherwise fallback
  // Client time must be <= server time (can't play longer than session exists)
  let gameDurationMs;
  if (clientElapsedMs > 0 && clientElapsedMs <= serverDurationMs + 5000) {
    gameDurationMs = Math.min(clientElapsedMs, MAX_DURATION_MS);
  } else {
    gameDurationMs = Math.max(lastInputTime + 500, Math.min(serverDurationMs, MAX_DURATION_MS));
  }
  
  console.log("⏱️ Duration:", { clientElapsedMs, serverDurationMs, lastInputTime, gameDurationMs });
  
  if (!Number.isFinite(gameDurationMs) || gameDurationMs <= 0) {
    res.status(400).json({ ok: false, error: "Invalid duration" });
    return;
  }

  const simResult = simulateRun({
    seed: session.seed,
    durationMs: gameDurationMs,
    inputEvents: inputLog
  });

  const simScore = simResult.score;
  const reported = Number.isFinite(Number(reportedScore))
    ? Number(reportedScore)
    : null;
  const tolerance = 2;
  const maxScore = Math.floor(gameDurationMs / DEFAULT_CONFIG.frameMs) + tolerance;

  if (reported === null) {
    res.status(400).json({ ok: false, error: "Missing reportedScore" });
    return;
  }

  if (reported > maxScore) {
    console.log("❌ 403: Score exceeds time limit", { reported, maxScore, serverDurationMs });
    res.status(403).json({
      ok: false,
      error: "Score exceeds time limit",
      maxScore
    });
    return;
  }

  // Verify reported score matches simulation (anti-cheat)
  // Higher tolerance to account for frame rate variations and timing differences
  const scoreTolerance = Math.max(200, Math.floor(gameDurationMs / 50)); // ~20% tolerance
  console.log("📊 Score check:", { reported, simScore, scoreTolerance, diff: reported - simScore, gameDurationMs });
  
  if (reported > simScore + scoreTolerance) {
    console.log("❌ 403: Score mismatch", { reported, simScore, scoreTolerance });
    res.status(403).json({
      ok: false,
      error: "Score mismatch - simulation does not match reported score",
      simScore,
      reported
    });
    return;
  }

  // Use reported score directly since simulation check is disabled
  // Still capped by maxScore (time-based limit)
  const finalScore = Math.min(reported, maxScore);
  const coinsAwarded = Math.floor(finalScore / 1000);
  console.log("💰 Awarding:", { finalScore, coinsAwarded, address: addressNorm });
  const result = await applyScore(addressNorm, finalScore, coinsAwarded);
  markSessionUsed(sessionId);

  res.json({
    ok: true,
    simScore,
    finalScore,
    maxScore,
    coinsAwarded,
    coinBalance: result ? result.coins : 0,
    bestScore: result ? result.best_score : finalScore,
    collidedAtMs: simResult.collidedAtMs,
    // On-chain mint info
    onChainMinted: result?.onChainMinted || 0,
    mintTxHash: result?.mintResult?.txHash || null
  });
});

app.get("/api/user/me", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.user.address);
  res.json({
    ok: true,
    address: user.address,
    coinBalance: user.coins,
    bestScore: user.best_score
    // streak and lastCheckin now read from blockchain
  });
});

// ============ Shop API ============
// Note: Check-in is now fully on-chain via GameCoin.checkin()

// Get all available characters
app.get("/api/shop/characters", async (req, res) => {
  try {
    const characters = await getCharacters();
    res.json({ ok: true, characters });
  } catch (err) {
    console.error("Get characters error:", err);
    res.status(500).json({ ok: false, error: "Failed to get characters" });
  }
});

// Get user's inventory and available coins
app.get("/api/shop/inventory", requireAuth, async (req, res) => {
  try {
    const inventory = await getUserInventory(req.user.address);
    const availableCoins = await getAvailableCoins(req.user.address);
    const user = await getOrCreateUser(req.user.address);
    
    res.json({
      ok: true,
      inventory,
      availableCoins,
      totalCoins: user.coins,
      hasClaimedFree: user.has_claimed_free || false
    });
  } catch (err) {
    console.error("Get inventory error:", err);
    res.status(500).json({ ok: false, error: "Failed to get inventory" });
  }
});

// Start a purchase (reserve coins, get signature)
app.post("/api/shop/purchase/start", requireAuth, async (req, res) => {
  const { characterId } = req.body || {};
  
  if (!characterId) {
    res.status(400).json({ ok: false, error: "Missing characterId" });
    return;
  }
  
  try {
    const result = await startPurchase(req.user.address, characterId);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("Start purchase error:", err);
    res.status(500).json({ ok: false, error: "Failed to start purchase" });
  }
});

// Confirm purchase after successful mint
app.post("/api/shop/purchase/confirm", requireAuth, async (req, res) => {
  const { nonce, txHash } = req.body || {};
  
  if (!nonce || !txHash) {
    res.status(400).json({ ok: false, error: "Missing nonce or txHash" });
    return;
  }
  
  try {
    const result = await confirmPurchase(req.user.address, nonce, txHash);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("Confirm purchase error:", err);
    res.status(500).json({ ok: false, error: "Failed to confirm purchase" });
  }
});

// Cancel pending purchase
app.post("/api/shop/purchase/cancel", requireAuth, async (req, res) => {
  const { nonce } = req.body || {};
  
  if (!nonce) {
    res.status(400).json({ ok: false, error: "Missing nonce" });
    return;
  }
  
  try {
    const result = await cancelPurchase(req.user.address, nonce);
    res.json(result);
  } catch (err) {
    console.error("Cancel purchase error:", err);
    res.status(500).json({ ok: false, error: "Failed to cancel purchase" });
  }
});

// Mark free character as claimed (after successful on-chain claim)
app.post("/api/shop/claim-free", requireAuth, async (req, res) => {
  const { txHash } = req.body || {};
  
  try {
    const user = await getOrCreateUser(req.user.address);
    
    if (user.has_claimed_free) {
      res.status(400).json({ ok: false, error: "Already claimed free character" });
      return;
    }
    
    const { updateUser } = require("./modules/user/userRepo");
    await updateUser(req.user.address, { has_claimed_free: true });
    
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("Claim free error:", err);
    res.status(500).json({ ok: false, error: "Failed to mark claim" });
  }
});

// Admin: Add character (protected - implement proper admin auth in production)
app.post("/api/admin/shop/character", requireAuth, async (req, res) => {
  // TODO: Add proper admin check
  const { characterId, name, description, imageUrl, metadataUri, price, maxSupply } = req.body || {};
  
  if (!characterId || !name) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }
  
  try {
    const character = await addCharacter({
      characterId,
      name,
      description,
      imageUrl,
      metadataUri,
      price: price || 0,
      maxSupply: maxSupply || 0
    });
    res.json({ ok: true, character });
  } catch (err) {
    console.error("Add character error:", err);
    res.status(500).json({ ok: false, error: "Failed to add character" });
  }
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
