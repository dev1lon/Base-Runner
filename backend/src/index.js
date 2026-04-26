require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { simulateRun, DEFAULT_CONFIG } = require("./sim");

// Character sprite files mapping (ID -> filename)
const CHARACTER_SPRITES = {
  0: 'vitalik_free.png',
  1: 'doge_common.png',
  2: 'hamaha_common.png',
  3: 'hayes_rare.png',
  4: 'pepe_rare.png',
  5: 'mask_epic.png',
  6: 'sam_epic.png',
  7: 'vlad_epic.png',
  8: 'cz_leg.png',
  9: 'trump_leg.png'
};
const {
  createSession,
  getSession,
  markSessionUsed,
  cleanupSessions
} = require("./modules/session/sessionStore");
const { getOrCreateUser, addCoins } = require("./modules/user/userRepo");
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
const { getCheckinStatus, doCheckin } = require("./modules/checkin/checkinService");

const { ethers } = require("ethers");

const app = express();

const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 60 * 60 * 1000); // 1 hour
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS || "").toLowerCase();
// Default: 3000000000000 wei = 0.000003 ETH ≈ $0.01 at ~$3333/ETH
const PAID_GAME_PRICE_WEI = BigInt(process.env.PAID_GAME_PRICE_WEI || "3000000000000");

// In-memory set to prevent reusing the same tx for multiple paid sessions
const usedPaidTxHashes = new Set();

// Payments contract (RugPullRunPayments) — handles paid game + coin purchases
const PAYMENTS_CONTRACT = (process.env.PAYMENTS_CONTRACT || "").toLowerCase();
const PAID_GAME_EVENT_TOPIC   = ethers.id("PaidGame(address,uint256,uint256,uint256)");
const COINS_PURCHASED_TOPIC   = ethers.id("CoinsPurchased(address,uint256,uint256,uint256,uint256)");

// USDC on Base mainnet (kept for reference / fallback)
const USDC_CONTRACT = (process.env.USDC_CONTRACT || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase();
const USDC_PER_COIN = BigInt(100_000); // 0.1 USDC (6 decimals)
const VALID_COIN_PACKAGES = new Set([10, 20, 50, 100, 500, 1000, 5000]);
const COIN_PACKAGE_USDC = new Map([
  [5000, BigInt(400_000_000)] // $400.00
]);
const usedCoinPurchaseTxHashes = new Set();

if (ALLOWED_ORIGIN === "*") {
  console.warn("⚠️  ALLOWED_ORIGIN is '*' — set a specific domain for production!");
}
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function randomSeed() {
  return `seed-${Math.random().toString(16).slice(2)}`;
}

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Public config for frontend (treasury address, paid game price)
app.get("/api/game-config", (req, res) => {
  res.json({
    treasuryAddress: TREASURY_ADDRESS || null,
    paidGamePriceWei: PAID_GAME_PRICE_WEI.toString()
  });
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
  // Store original address for message reconstruction (checksum matters for signature)
  const result = await issueNonce(addressNorm, String(chainId), address);
  res.json({ ok: true, nonce: result.nonce, issuedAt: result.issuedAt });
});

app.post("/auth/verify", async (req, res) => {
  const { address, signature } = req.body || {};
  const addressNorm = normalizeAddress(address);
  if (!addressNorm || !signature) {
    res.status(400).json({ ok: false, error: "Invalid address" });
    return;
  }
  const result = await verifyNonce({ address: addressNorm, signature, originalAddress: address });
  if (!result.ok) {
    console.warn(`[auth/verify] FAILED address=${addressNorm} error=${result.error} sigLen=${signature?.length} sigEnd=${signature?.slice(-8)}`);
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  const checkin = await getCheckinStatus(addressNorm);
  res.json({
    ok: true,
    token: result.token,
    address: result.user.address,
    coinBalance: result.user.coins,
    bestScore: result.user.best_score,
    hasFreeMint: result.user.has_claimed_free || false,
    ownedCharacters: result.user.owned_characters || [],
    selectedCharacter: result.user.selected_character || 0,
    checkin
  });
});

// SIWE verify — parses EIP-4361 message to extract address, then reuses existing nonce/JWT flow
app.post("/auth/siwe-verify", async (req, res) => {
  const { message, signature } = req.body || {};
  if (!message || !signature) {
    return res.status(400).json({ ok: false, error: "Missing message or signature" });
  }
  try {
    const { SiweMessage } = require("siwe");
    const siwe = new SiweMessage(message);
    const address = siwe.address;
    const addressNorm = normalizeAddress(address);
    if (!addressNorm) return res.status(400).json({ ok: false, error: "Invalid address in SIWE message" });

    const result = await verifyNonce({ address: addressNorm, signature, originalAddress: address, signedMessage: message });
    if (!result.ok) {
      console.warn(`[auth/siwe-verify] FAILED address=${addressNorm} error=${result.error}`);
      return res.status(400).json({ ok: false, error: result.error });
    }
    const checkin = await getCheckinStatus(addressNorm);
    res.json({
      ok: true,
      token: result.token,
      address: result.user.address,
      coinBalance: result.user.coins,
      bestScore: result.user.best_score,
      hasFreeMint: result.user.has_claimed_free || false,
      ownedCharacters: result.user.owned_characters || [],
      selectedCharacter: result.user.selected_character || 0,
      checkin
    });
  } catch (err) {
    console.error("[auth/siwe-verify] error:", err);
    res.status(500).json({ ok: false, error: "Verification failed" });
  }
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

app.post("/api/session/start-paid", requireAuth, async (req, res) => {
  const { txHash } = req.body || {};
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ ok: false, error: "Invalid txHash" });
  }
  if (!TREASURY_ADDRESS) {
    return res.status(503).json({ ok: false, error: "Paid games not configured" });
  }
  if (usedPaidTxHashes.has(txHash)) {
    return res.status(400).json({ ok: false, error: "Transaction already used" });
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
    // Verify txHash is a real confirmed tx on Base mainnet (not fabricated).
    // Retry a few times — backend RPC may lag behind the wallet.
    let receipt = null;
    for (let i = 0; i < 5; i++) {
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!receipt) {
      return res.status(400).json({ ok: false, error: "Transaction not found on chain" });
    }
    if (receipt.status !== 1) {
      return res.status(400).json({ ok: false, error: "Transaction failed on-chain" });
    }

    // Verify PaidGame event from payments contract
    if (PAYMENTS_CONTRACT) {
      const playerTopic = "0x" + req.user.address.slice(2).padStart(64, "0");
      const paidLog = receipt.logs.find(log =>
        log.address.toLowerCase() === PAYMENTS_CONTRACT &&
        log.topics[0] === PAID_GAME_EVENT_TOPIC &&
        log.topics[1]?.toLowerCase() === playerTopic
      );
      if (!paidLog) {
        return res.status(400).json({ ok: false, error: "PaidGame event not found in transaction" });
      }
      const [value] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256", "uint256"], paidLog.data
      );
      if (BigInt(value) < PAID_GAME_PRICE_WEI) {
        return res.status(400).json({ ok: false, error: "Insufficient payment value" });
      }
    }

    usedPaidTxHashes.add(txHash);

    const addressNorm = req.user.address;
    const seed = randomSeed();
    const session = createSession({ address: addressNorm, seed, ttlMs: SESSION_TTL_MS, paid: true });
    res.json({
      ok: true,
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
  } catch (err) {
    console.error("start-paid error:", err);
    res.status(500).json({ ok: false, error: "Failed to verify payment" });
  }
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

  // Use client-reported game duration
  const clientElapsedMs = Number.isFinite(Number(gameElapsedMs)) ? Number(gameElapsedMs) : 0;
  const serverDurationMs = Date.now() - session.issuedAt;
  
  // Use client time, fallback to server time
  const gameDurationMs = clientElapsedMs > 0 ? clientElapsedMs : serverDurationMs;
  
  console.log("⏱️ Duration:", { clientElapsedMs, serverDurationMs, gameDurationMs });

  // SIMULATION DISABLED - uncomment to enable
  // const simResult = simulateRun({
  //   seed: session.seed,
  //   durationMs: gameDurationMs,
  //   inputEvents: inputLog
  // });
  // const simScore = simResult.score;

  const reported = Number.isFinite(Number(reportedScore))
    ? Number(reportedScore)
    : null;
  const tolerance = 5;
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

  // Anti-cheat: maxScore check (time-based limit)
  console.log("📊 Score info:", { reported, maxScore, gameDurationMs });

  const finalScore = Math.min(reported, maxScore);
  const coinsPerScore = session.paid ? 5 : 1;
  const coinsAwarded = Math.floor(finalScore / 1000) * coinsPerScore;
  console.log("💰 Awarding:", { finalScore, coinsAwarded, paid: session.paid, address: addressNorm });
  markSessionUsed(sessionId);
  const result = await applyScore(addressNorm, finalScore, coinsAwarded);

  res.json({
    ok: true,
    finalScore,
    maxScore,
    coinsAwarded,
    coinBalance: result ? result.coins : 0,
    bestScore: result ? result.best_score : finalScore
  });
});

app.get("/api/user/me", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.user.address);
  const checkin = await getCheckinStatus(req.user.address);

  res.json({
    ok: true,
    address: user.address,
    coinBalance: user.coins,
    checkin,
    bestScore: user.best_score,
    hasFreeMint: user.has_claimed_free || false,
    ownedCharacters: user.owned_characters || [],
    selectedCharacter: user.selected_character || 0
  });
});

// ============ Check-in API ============

app.get("/api/checkin/status", requireAuth, async (req, res) => {
  try {
    const status = await getCheckinStatus(req.user.address);
    res.json({ ok: true, ...status });
  } catch (err) {
    console.error("Checkin status error:", err);
    res.status(500).json({ ok: false, error: "Failed to get checkin status" });
  }
});

app.post("/api/checkin", requireAuth, async (req, res) => {
  try {
    const { txHash } = req.body || {};
    const result = await doCheckin(req.user.address, txHash);

    // Send instant notification confirming check-in (if user has notifications enabled)
    if (result?.ok) {
      try {
        const { rows } = await require("./shared/db").query(
          `SELECT notification_url, notification_token, streak FROM users WHERE address=$1`,
          [req.user.address]
        );
        const u = rows[0];
        if (u?.notification_url && u?.notification_token) {
          sendNotification({
            url: u.notification_url,
            token: u.notification_token,
            title: u.streak >= 5 ? `🔥 ${u.streak}-day streak!` : "Check-in done",
            body: `+${result.reward || 1} coins. Come back in 24h to keep your streak.`,
          }).catch(() => {});
        }
      } catch (_) { /* notifications best-effort */ }
    }

    res.json(result);
  } catch (err) {
    console.error("Checkin error:", err);
    res.status(500).json({ ok: false, error: "Check-in failed" });
  }
});

// ============ Shop API ============

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
  const { txHash, characterId = 0 } = req.body || {};

  // txHash is optional for backend-only free mint (no blockchain)
  if (txHash && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ ok: false, error: "Invalid txHash" });
  }

  try {
    const user = await getOrCreateUser(req.user.address);
    
    if (user.has_claimed_free) {
      res.status(400).json({ ok: false, error: "Already claimed free character" });
      return;
    }
    
    const { updateUser, addOwnedCharacter } = require("./modules/user/userRepo");
    await updateUser(req.user.address, { has_claimed_free: true });
    await addOwnedCharacter(req.user.address, characterId);
    
    const updatedUser = await getOrCreateUser(req.user.address);
    
    res.json({
      ok: true,
      txHash,
      hasFreeMint: true,
      ownedCharacters: updatedUser.owned_characters || [characterId]
    });
  } catch (err) {
    console.error("Claim free error:", err);
    res.status(500).json({ ok: false, error: "Failed to mark claim" });
  }
});

// Buy coins with USDC
app.post("/api/shop/buy-coins", requireAuth, async (req, res) => {
  const { coins, txHash } = req.body || {};
  if (!coins || !txHash) {
    return res.status(400).json({ ok: false, error: "Missing coins or txHash" });
  }
  if (!VALID_COIN_PACKAGES.has(Number(coins))) {
    return res.status(400).json({ ok: false, error: "Invalid coin package" });
  }
  if (!TREASURY_ADDRESS) {
    return res.status(503).json({ ok: false, error: "Store not configured" });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ ok: false, error: "Invalid txHash" });
  }
  if (usedCoinPurchaseTxHashes.has(txHash)) {
    return res.status(400).json({ ok: false, error: "Transaction already used" });
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
    let receipt = null;
    for (let i = 0; i < 5; i++) {
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    if (!receipt) return res.status(400).json({ ok: false, error: "Transaction not found on chain" });
    if (receipt.status !== 1) return res.status(400).json({ ok: false, error: "Transaction failed on-chain" });

    // Verify CoinsPurchased event from payments contract
    const expectedUSDC = COIN_PACKAGE_USDC.get(Number(coins)) ?? (USDC_PER_COIN * BigInt(coins));
    if (PAYMENTS_CONTRACT) {
      const buyerTopic = "0x" + req.user.address.slice(2).padStart(64, "0");
      const coinsLog = receipt.logs.find(log =>
        log.address.toLowerCase() === PAYMENTS_CONTRACT &&
        log.topics[0] === COINS_PURCHASED_TOPIC &&
        log.topics[1]?.toLowerCase() === buyerTopic
      );
      if (!coinsLog) {
        return res.status(400).json({ ok: false, error: "CoinsPurchased event not found" });
      }
      const [coinsAmt, usdcAmt] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256", "uint256", "uint256"], coinsLog.data
      );
      if (Number(coinsAmt) !== Number(coins)) {
        return res.status(400).json({ ok: false, error: "Coins amount mismatch" });
      }
      if (BigInt(usdcAmt) < expectedUSDC) {
        return res.status(400).json({ ok: false, error: "Insufficient USDC payment" });
      }
    }

    usedCoinPurchaseTxHashes.add(txHash);
    const updatedUser = await addCoins(req.user.address, Number(coins));
    res.json({ ok: true, coinsAdded: Number(coins), newBalance: updatedUser?.coins ?? 0 });
  } catch (err) {
    console.error("Buy coins error:", err);
    res.status(500).json({ ok: false, error: "Failed to process purchase" });
  }
});

// Note: record-purchase removed — use /api/shop/purchase/confirm instead

// Update selected character
app.post("/api/user/select-character", requireAuth, async (req, res) => {
  const { characterId } = req.body || {};
  
  if (characterId === undefined) {
    res.status(400).json({ ok: false, error: "Missing characterId" });
    return;
  }
  
  try {
    const { updateUser } = require("./modules/user/userRepo");
    const user = await getOrCreateUser(req.user.address);
    
    // Check if user owns this character
    const owned = user.owned_characters || [];
    if (!owned.includes(characterId) && !(characterId === 0 && user.has_claimed_free)) {
      res.status(400).json({ ok: false, error: "Character not owned" });
      return;
    }
    
    await updateUser(req.user.address, { selected_character: characterId });
    
    res.json({ ok: true, selectedCharacter: characterId });
  } catch (err) {
    console.error("Select character error:", err);
    res.status(500).json({ ok: false, error: "Failed to select character" });
  }
});

// ============ Protected Sprites API ============

// Public silhouette preview — returns sprite without auth (for locked card silhouettes)
app.get("/api/sprites/preview/:characterId", async (req, res) => {
  const characterId = parseInt(req.params.characterId);
  if (isNaN(characterId) || !CHARACTER_SPRITES[characterId]) {
    res.status(404).end();
    return;
  }
  const spritePath = path.join(__dirname, "sprites", CHARACTER_SPRITES[characterId]);
  res.sendFile(spritePath);
});

// Get sprite for owned character (returns image file)
app.get("/api/sprites/:characterId", requireAuth, async (req, res) => {
  const characterId = parseInt(req.params.characterId);
  
  if (isNaN(characterId) || !CHARACTER_SPRITES[characterId]) {
    res.status(404).json({ ok: false, error: "Character not found" });
    return;
  }
  
  try {
    const user = await getOrCreateUser(req.user.address);
    const owned = user.owned_characters || [];
    
    // Check ownership (character 0 with free mint, or in owned list)
    const ownsCharacter = owned.includes(characterId) || 
                          (characterId === 0 && user.has_claimed_free);
    
    if (!ownsCharacter) {
      res.status(403).json({ ok: false, error: "Character not owned" });
      return;
    }
    
    // Serve the sprite file
    const spritePath = path.join(__dirname, 'sprites', CHARACTER_SPRITES[characterId]);
    
    if (!fs.existsSync(spritePath)) {
      console.error("Sprite file not found:", spritePath);
      res.status(404).json({ ok: false, error: "Sprite file not found" });
      return;
    }
    
    res.sendFile(spritePath);
  } catch (err) {
    console.error("Get sprite error:", err);
    res.status(500).json({ ok: false, error: "Failed to get sprite" });
  }
});

// Get all owned sprites URLs (returns list of sprite URLs)
app.get("/api/sprites", requireAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req.user.address);
    const owned = user.owned_characters || [];
    
    // Build sprite URLs for owned characters
    const sprites = {};
    
    for (const charId of owned) {
      if (CHARACTER_SPRITES[charId]) {
        sprites[charId] = `/api/sprites/${charId}`;
      }
    }
    
    // Add character 0 if has free mint
    if (user.has_claimed_free && CHARACTER_SPRITES[0]) {
      sprites[0] = `/api/sprites/0`;
    }
    
    res.json({
      ok: true,
      sprites,
      ownedCharacters: owned,
      selectedCharacter: user.selected_character || 0
    });
  } catch (err) {
    console.error("Get sprites error:", err);
    res.status(500).json({ ok: false, error: "Failed to get sprites" });
  }
});

// Admin: Add character (only contract owner / signer can call)
const ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES || "").toLowerCase().split(",").filter(Boolean);

app.post("/api/admin/shop/character", requireAuth, async (req, res) => {
  if (!ADMIN_ADDRESSES.includes(req.user.address)) {
    res.status(403).json({ ok: false, error: "Not authorized" });
    return;
  }
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


// Farcaster mini-app webhook endpoint
// Receives: miniapp_added, miniapp_removed, notifications_enabled, notifications_disabled
const {
  saveNotificationToken,
  clearNotificationToken,
  linkFidToAddress,
  sendNotification,
  runCheckinReminderJob,
} = require("./modules/notifications/notificationService");

app.post("/api/notifications", async (req, res) => {
  try {
    let event;
    try {
      const { parseWebhookEvent, verifyAppKeyWithNeynar } = require("@farcaster/miniapp-node");
      event = await parseWebhookEvent(req.body, verifyAppKeyWithNeynar);
    } catch (e) {
      console.warn("[notifications] SDK parse failed, using raw body:", e.message);
      event = req.body;
    }
    const fid = event?.fid || event?.event?.fid;
    const data = event?.event || event;
    const type = data?.event;

    if (type === "miniapp_added" || type === "notifications_enabled") {
      const token = data?.notificationDetails?.token;
      const url = data?.notificationDetails?.url;
      if (fid && token && url) {
        await saveNotificationToken({ fid, url, token });
        console.log(`[notifications] registered fid=${fid}`);
      }
    } else if (type === "miniapp_removed" || type === "notifications_disabled") {
      if (fid) {
        await clearNotificationToken({ fid });
        console.log(`[notifications] removed fid=${fid}`);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[notifications] error:", err);
    res.status(200).json({ ok: true });
  }
});

// Link Farcaster FID to wallet address (called after SIWE auth in mini-app context)
app.post("/api/user/link-fid", requireAuth, async (req, res) => {
  const { fid } = req.body || {};
  if (!fid || !Number.isFinite(Number(fid))) {
    return res.status(400).json({ ok: false, error: "Invalid fid" });
  }
  try {
    await linkFidToAddress({ address: req.user.address, fid: Number(fid) });

    // Copy notification token from any other row that has this FID
    // (webhook may have stored the token before address was known)
    const { query } = require("./shared/db");
    const { rows } = await query(
      `SELECT notification_url, notification_token FROM users
       WHERE fid=$1 AND notification_token IS NOT NULL AND address != $2
       LIMIT 1`,
      [Number(fid), req.user.address.toLowerCase()]
    );
    if (rows[0]?.notification_token) {
      await query(
        `UPDATE users SET notification_url=$1, notification_token=$2 WHERE address=$3`,
        [rows[0].notification_url, rows[0].notification_token, req.user.address.toLowerCase()]
      );
      console.log(`[link-fid] copied notification token to ${req.user.address}`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("link-fid error:", e);
    res.status(500).json({ ok: false, error: "Failed to link fid" });
  }
});

// Test: manually trigger check-in reminder job (admin only via secret header)
app.post("/api/admin/test-notifications", async (req, res) => {
  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  await runCheckinReminderJob();
  res.json({ ok: true, message: "Reminder job executed" });
});

// Test: send a single notification to the authenticated user
app.post("/api/user/test-notification", requireAuth, async (req, res) => {
  try {
    const { rows } = await require("./shared/db").query(
      `SELECT notification_url, notification_token, fid FROM users WHERE address=$1`,
      [req.user.address]
    );
    const u = rows[0];
    if (!u?.notification_token) {
      return res.status(400).json({ ok: false, error: "No notification token. Enable notifications in Base App first." });
    }
    const r = await sendNotification({
      url: u.notification_url,
      token: u.notification_token,
      title: "Test notification",
      body: "Rug Pull Run notifications work!",
      targetUrl: process.env.APP_URL || "https://rugpullrun.app",
    });
    res.json({ ok: r.ok, fid: u.fid, result: r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

setInterval(cleanupSessions, 60 * 1000);
// Check-in reminder job: every hour, push notification to users whose 24h cooldown
// just expired (so they can keep their streak alive).
setInterval(runCheckinReminderJob, 60 * 60 * 1000);

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
