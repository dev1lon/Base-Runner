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
const { mintCoins } = require("./shared/blockchain");

const { ethers } = require("ethers");

const CHARACTER_UPGRADE_ADDRESS = process.env.CHARACTER_UPGRADE_ADDRESS || "0xf7d33fBE432eC51330955494083be4824606F3D1";
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
let rpcProvider;
let characterUpgradeReadContract;

function getRpcProvider() {
  if (!rpcProvider) {
    rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return rpcProvider;
}

// Minimal ABI for reading character XP on-chain
const CHARACTER_UPGRADE_ABI = [
  "function getCharacterInfo(address player, uint256 characterId) view returns (uint256 lvl, uint256 xp, uint256 xpNext, uint256 xpPrev)"
];

const LEVEL_COIN_BONUS       = [0, 1, 2, 3, 4, 5];   // extra coins per 1000pts per level
const LEVEL_SCORE_MULTIPLIER = [1.0, 1.1, 1.2, 1.3, 1.5, 2.0];

async function getCharacterLevel(playerAddress, characterId) {
  if (!CHARACTER_UPGRADE_ADDRESS) return 0;
  try {
    if (!characterUpgradeReadContract) {
      characterUpgradeReadContract = new ethers.Contract(CHARACTER_UPGRADE_ADDRESS, CHARACTER_UPGRADE_ABI, getRpcProvider());
    }
    const info = await characterUpgradeReadContract.getCharacterInfo(playerAddress, characterId);
    return Number(info.lvl);
  } catch (e) {
    console.warn("[level] Failed to read character level:", e.message);
    return 0;
  }
}

const app = express();

const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 60 * 60 * 1000); // 1 hour
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS || "").toLowerCase();
const PAYMASTER_URL = process.env.PAYMASTER_URL || "";
const ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES || "").toLowerCase().split(",").filter(Boolean);
// Default: 3000000000000 wei = 0.000003 ETH ≈ $0.01 at ~$3333/ETH
const PAID_GAME_PRICE_WEI = BigInt(process.env.PAID_GAME_PRICE_WEI || "3000000000000");
const GC_PER_COIN = 5;

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

function isAdminAddress(address) {
  return ADMIN_ADDRESSES.includes(String(address || "").toLowerCase());
}

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Public config for frontend (treasury address, paid game price)
app.get("/api/game-config", (req, res) => {
  res.json({
    treasuryAddress: TREASURY_ADDRESS || null,
    paidGamePriceWei: PAID_GAME_PRICE_WEI.toString(),
    paymasterUrl: PAYMASTER_URL || ""
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
    checkin,
    isAdmin: isAdminAddress(result.user.address)
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
      checkin,
      isAdmin: isAdminAddress(result.user.address)
    });
  } catch (err) {
    console.error("[auth/siwe-verify] error:", err);
    res.status(500).json({ ok: false, error: "Verification failed" });
  }
});

app.post("/api/session/start", requireAuth, async (req, res) => {
  const addressNorm = req.user.address;
  const { characterId = 0 } = req.body || {};
  const seed = randomSeed();
  const lockedCharacterId = Number(characterId) || 0;
  const characterLevel = await getCharacterLevel(addressNorm, lockedCharacterId);
  const session = createSession({
    address: addressNorm,
    seed,
    ttlMs: SESSION_TTL_MS,
    characterId: lockedCharacterId,
    characterLevel,
  });
  res.json({
    sessionId: session.sessionId,
    seed: session.seed,
    characterId: lockedCharacterId,
    characterLevel,
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
  const { txHash, characterId = 0 } = req.body || {};
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
    const provider = getRpcProvider();
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
    const lockedCharacterId = Number(characterId) || 0;
    const characterLevel = await getCharacterLevel(addressNorm, lockedCharacterId);
    const session = createSession({
      address: addressNorm,
      seed,
      ttlMs: SESSION_TTL_MS,
      paid: true,
      characterId: lockedCharacterId,
      characterLevel,
    });
    res.json({
      ok: true,
      sessionId: session.sessionId,
      seed: session.seed,
      characterId: lockedCharacterId,
      characterLevel,
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

  const rawScore = Math.min(reported, maxScore);

  // Character level is locked at session start, so upgrades during a paused run do not affect it.
  const charLevel = Number.isFinite(Number(session.characterLevel)) ? Number(session.characterLevel) : 0;
  const scoreMultiplier  = LEVEL_SCORE_MULTIPLIER[charLevel] || 1.0;
  const levelCoinBonus   = LEVEL_COIN_BONUS[charLevel] || 0;
  const adjustedScore    = Math.floor(rawScore * scoreMultiplier);
  const baseCoins        = session.paid ? 5 : 1;
  const coinsAwarded     = Math.floor(adjustedScore / 1000) * (baseCoins + levelCoinBonus);

  console.log("💰 Awarding:", { rawScore, adjustedScore, coinsAwarded, paid: session.paid, charLevel, address: addressNorm });
  markSessionUsed(sessionId);
  const result = await applyScore(addressNorm, adjustedScore, coinsAwarded);

  res.json({
    ok: true,
    finalScore: adjustedScore,
    rawScore,
    maxScore,
    coinsAwarded,
    coinBalance: result ? result.coins : 0,
    bestScore: result ? result.best_score : adjustedScore,
    charLevel,
    scoreMultiplier,
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
    selectedCharacter: user.selected_character || 0,
    isAdmin: isAdminAddress(user.address)
  });
});

// ============ Check-in API ============

// ============ Leaderboard ============

// In-memory cache: { address: { name, fetchedAt } }
const baseNameCache = new Map();
const BASE_NAME_TTL_MS = 60 * 60 * 1000; // 1 hour

// Basenames reverse resolution — same flow the frontend uses:
//   1) ReverseRegistrar.node(addr) -> bytes32 reverse node
//   2) L2Resolver.name(node)       -> string
const BASE_REVERSE_REGISTRAR = "0x79EA96012eEa67A83431F1701B3dFf7e37F9E282";
const BASE_L2_RESOLVER       = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";
const BASE_RPC_URL           = process.env.RPC_URL || "https://mainnet.base.org";

async function rpcCall(to, data) {
  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const json = await res.json();
  return json.result;
}

function decodeAbiString(hexResult) {
  if (!hexResult || hexResult === "0x" || hexResult.length <= 130) return null;
  const hex = hexResult.slice(2);
  const strOffset = parseInt(hex.slice(0, 64), 16) * 2;
  const strLen    = parseInt(hex.slice(strOffset, strOffset + 64), 16);
  if (!strLen || strLen > 256) return null;
  const strHex = hex.slice(strOffset + 64, strOffset + 64 + strLen * 2);
  try {
    return new TextDecoder().decode(new Uint8Array(strHex.match(/.{2}/g).map(b => parseInt(b, 16))));
  } catch { return null; }
}

async function resolveBaseName(address) {
  if (!address) return null;
  const key = address.toLowerCase();
  const cached = baseNameCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < BASE_NAME_TTL_MS) return cached.name;

  let name = null;
  let lastError = null;
  try {
    const paddedAddr = key.slice(2).padStart(64, "0");
    const reverseNode = await rpcCall(BASE_REVERSE_REGISTRAR, "0xbffbe61c" + paddedAddr);
    if (!reverseNode || reverseNode === "0x" || reverseNode.length < 66) {
      lastError = `bad node: ${reverseNode}`;
    } else {
      const nameResult = await rpcCall(BASE_L2_RESOLVER, "0x691f3431" + reverseNode.slice(2));
      if (!nameResult || nameResult === "0x") {
        lastError = `empty name result: ${nameResult}`;
      } else {
        const decoded = decodeAbiString(nameResult);
        if (decoded && decoded.includes(".")) name = decoded;
        else lastError = `decode failed: ${nameResult?.slice(0, 80)}`;
      }
    }
  } catch (e) { lastError = e.message; }

  if (!name && lastError) {
    console.warn(`[basename] ${key} -> null (${lastError})`);
  }

  baseNameCache.set(key, { name, fetchedAt: Date.now() });
  return name;
}

let leaderboardCache = { data: null, fetchedAt: 0 };
const LEADERBOARD_TTL_MS = 30 * 1000; // 30s cache

app.get("/api/leaderboard", async (req, res) => {
  try {
    if (leaderboardCache.data && Date.now() - leaderboardCache.fetchedAt < LEADERBOARD_TTL_MS) {
      return res.json({ ok: true, entries: leaderboardCache.data, cached: true });
    }

    const { rows } = await require("./shared/db").query(
      `SELECT address, best_score FROM users WHERE best_score > 0 ORDER BY best_score DESC LIMIT 200`
    );

    // Filter out admins (overfetch with LIMIT 200 to keep 100 after filter)
    const filtered = rows.filter(r => !isAdminAddress(r.address)).slice(0, 100);

    // Batch basename resolution to avoid hammering public Base RPC (rate-limits)
    const entries = [];
    let resolved = 0, withNames = 0;
    const CONCURRENCY = 5;
    for (let i = 0; i < filtered.length; i += CONCURRENCY) {
      const batch = filtered.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(r => resolveBaseName(r.address)));
      batch.forEach((r, j) => {
        const name = results[j] || null;
        resolved++;
        if (name) withNames++;
        entries.push({
          rank: entries.length + 1,
          address: r.address,
          name,
          score: Number(r.best_score),
        });
      });
    }
    console.log(`[leaderboard] resolved ${resolved} addresses, ${withNames} with basenames`);

    leaderboardCache = { data: entries, fetchedAt: Date.now() };
    res.json({ ok: true, entries });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ ok: false, error: "Failed to load leaderboard" });
  }
});

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
    let notification = null;

    if (result?.ok) {
      notification = await sendNotification({
        walletAddress: req.user.address,
        title: result.streak >= 5 ? "Streak milestone!" : "Check-in done",
        message: `+${result.reward || 1} coins earned. Come back in 24h to keep your streak.`,
        targetPath: "/",
      }).catch(e => ({ ok: false, error: e.message }));

      if (!notification?.ok) {
        console.warn(`[notifications] check-in notification failed for ${req.user.address}:`, notification?.error || notification);
      }
    }

    res.json({
      ...result,
      notification: notification
        ? {
            ok: notification.ok === true,
            sentCount: notification.sentCount || 0,
            error: notification.ok ? undefined : notification.error,
          }
        : null,
    });
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

// Deduct in-game coins after user has minted GC on-chain (1 coin = 5 GC)
app.post("/api/coins/spend-for-gc", requireAuth, async (req, res) => {
  const { coinsAmount } = req.body || {};
  const amount = Number(coinsAmount);
  if (!Number.isFinite(amount) || amount < 1) {
    return res.status(400).json({ ok: false, error: "Invalid coinsAmount" });
  }
  try {
    const { rows } = await require("./shared/db").query(
      `UPDATE users SET coins = coins - $1, updated_at = NOW()
       WHERE address = $2 AND coins >= $1
       RETURNING coins`,
      [amount, req.user.address]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Insufficient coins" });
    }
    res.json({ ok: true, coinBalance: rows[0].coins });
  } catch (e) {
    console.error("spend-for-gc error:", e);
    res.status(500).json({ ok: false, error: "Failed to deduct coins" });
  }
});

// Secure GC conversion: spend in-game coins, then backend minter mints GC on-chain.
app.post("/api/coins/mint-gc", requireAuth, async (req, res) => {
  const { coinsAmount } = req.body || {};
  const amount = Number(coinsAmount);
  if (!Number.isInteger(amount) || amount < 1) {
    return res.status(400).json({ ok: false, error: "Invalid coinsAmount" });
  }

  const gcAmount = amount * GC_PER_COIN;
  const db = require("./shared/db");

  try {
    const { rows } = await db.query(
      `UPDATE users SET coins = coins - $1, updated_at = NOW()
       WHERE address = $2 AND coins >= $1
       RETURNING coins`,
      [amount, req.user.address]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Insufficient coins" });
    }

    const mintResult = await mintCoins(req.user.address, gcAmount);
    if (!mintResult.success) {
      await db.query(
        `UPDATE users SET coins = coins + $1, updated_at = NOW()
         WHERE address = $2`,
        [amount, req.user.address]
      ).catch(e => console.error("mint-gc refund failed:", e));
      return res.status(502).json({ ok: false, error: mintResult.error || "GC mint failed" });
    }

    res.json({
      ok: true,
      coinBalance: rows[0].coins,
      gcAmount,
      txHash: mintResult.txHash,
    });
  } catch (e) {
    console.error("mint-gc error:", e);
    res.status(500).json({ ok: false, error: "Failed to mint GC" });
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
    const provider = getRpcProvider();
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

app.post("/api/admin/shop/character", requireAuth, async (req, res) => {
  if (!isAdminAddress(req.user.address)) {
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


const {
  getNotificationStatus,
  getNotificationUserStatus,
  sendNotification,
  sendBroadcastNotification,
  runCheckinReminderJob
} = require("./modules/notifications/notificationService");

app.get("/api/notifications/status", (req, res) => {
  res.json({ ok: true, ...getNotificationStatus() });
});

app.get("/api/user/notification-status", requireAuth, async (req, res) => {
  const r = await getNotificationUserStatus(req.user.address);
  res.json(r);
});

const BROADCAST_NOTIFICATION_COPY = [
  {
    title: "Ready to run?",
    message: "Jump back into Rug Pull Run and chase a new high score.",
  },
  {
    title: "The market is moving",
    message: "Start a run, dodge the candles, and stack more coins.",
  },
  {
    title: "New run waiting",
    message: "Your runner is ready. Come back and push the leaderboard.",
  },
  {
    title: "Don't get rugged",
    message: "Open Rug Pull Run and see how far you can survive today.",
  },
  {
    title: "Coins are calling",
    message: "Play another round and build up your next upgrade.",
  },
];

function getBroadcastNotificationCopy() {
  return BROADCAST_NOTIFICATION_COPY[Math.floor(Math.random() * BROADCAST_NOTIFICATION_COPY.length)];
}

app.post("/api/user/test-notification", requireAuth, async (req, res) => {
  if (!isAdminAddress(req.user.address)) {
    res.status(403).json({ ok: false, error: "Not authorized" });
    return;
  }
  const copy = getBroadcastNotificationCopy();
  const r = await sendBroadcastNotification({
    title: copy.title,
    message: copy.message,
    targetPath: `/?notification=${Date.now()}`,
  });
  res.json(r);
});

// Hourly job: remind users whose 24h cooldown expired before their streak times out
setTimeout(runCheckinReminderJob, 30 * 1000);
setInterval(runCheckinReminderJob, 60 * 60 * 1000);
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
