require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { FRAME_MS, VERSION, simulateRun } = require("./run-engine");
const { normalizeTxHash, applyPayment } = require("./shared/payments");

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
const CHARACTER_PREVIEWS = Object.fromEntries(
  Object.entries(CHARACTER_SPRITES).map(([id, filename]) => [id, filename.replace(/\.png$/i, ".webp")])
);
const SPRITE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PRIVATE_SPRITE_CACHE_CONTROL = "private, max-age=31536000, immutable";
const { createSession, completeSession, cleanupSessions } = require("./modules/session/sessionStore");
const { getOrCreateUser } = require("./modules/user/userRepo");
const {
  getCharacters,
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
// Public Base mainnet RPC for low-traffic on-chain reads (character levels, etc.)
const PUBLIC_RPC_URL    = "https://mainnet.base.org";
const FALLBACK_RPC_URL  = process.env.LEADERBOARD_RPC_URL || process.env.RPC_URL || "";
let rpcProvider, fallbackRpcProvider;
let characterUpgradeReadContract;

function getRpcProvider() {
  if (!rpcProvider) {
    rpcProvider = new ethers.JsonRpcProvider(PUBLIC_RPC_URL);
  }
  return rpcProvider;
}
function getFallbackRpcProvider() {
  if (!FALLBACK_RPC_URL) return null;
  if (!fallbackRpcProvider) {
    fallbackRpcProvider = new ethers.JsonRpcProvider(FALLBACK_RPC_URL);
  }
  return fallbackRpcProvider;
}

// Race an RPC call against a timeout; on timeout or failure, retry with the
// paid fallback (LEADERBOARD_RPC_URL) if configured.
async function withRpcFallback(callFn, timeoutMs = 8000) {
  const publicProvider = getRpcProvider();
  const race = (provider) => Promise.race([
    callFn(provider),
    new Promise((_, reject) => setTimeout(() => reject(new Error("rpc-timeout")), timeoutMs)),
  ]);
  try {
    return await race(publicProvider);
  } catch (e) {
    const fb = getFallbackRpcProvider();
    if (!fb) throw e;
    console.warn("[rpc] public failed, falling back to paid RPC:", e.message);
    return await race(fb);
  }
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
    const info = await withRpcFallback(async (provider) => {
      const c = new ethers.Contract(CHARACTER_UPGRADE_ADDRESS, CHARACTER_UPGRADE_ABI, provider);
      return c.getCharacterInfo(playerAddress, characterId);
    });
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
// Boot-time fallback only — the live price is read from the contract (see
// refreshOnChainPrices). 407000000000000 wei = 0.000407 ETH ≈ $1.00.
const PAID_GAME_PRICE_WEI = BigInt(process.env.PAID_GAME_PRICE_WEI || "407000000000000");
const GC_PER_COIN = 5;

// Payments contract (RugPullRunPayments) — handles paid game + coin purchases
const PAYMENTS_CONTRACT = (process.env.PAYMENTS_CONTRACT || "").toLowerCase();
// Accept both the V2 and V3 signatures: V3 adds a trailing `priceWei` field, so
// the topic hash changes while the leading data words we read stay in place.
// Matching both means deploying V3 is a PAYMENTS_CONTRACT env change, nothing more.
const PAID_GAME_TOPICS = new Set([
  ethers.id("PaidGame(address,uint256,uint256,uint256)"),            // V2
  ethers.id("PaidGame(address,uint256,uint256,uint256,uint256)")     // V3
]);
const COINS_PURCHASED_TOPICS = new Set([
  ethers.id("CoinsPurchased(address,uint256,uint256,uint256,uint256)")
]);
const LEADERBOARD_SAVED_TOPICS = new Set([
  ethers.id("LeaderboardSaved(address,uint256,uint256,uint256,uint256)"),          // V2
  ethers.id("LeaderboardSaved(address,uint256,uint256,uint256,uint256,uint256)")   // V3
]);
// Boot-time fallback for the leaderboard save price.
// 40700000000000 wei = 0.0000407 ETH ≈ $0.10.
const SAVE_LEADERBOARD_PRICE_WEI = BigInt(process.env.SAVE_LEADERBOARD_PRICE_WEI || "40700000000000");

// ---------------------------------------------------------------------------
// Live prices — the payments contract is the single source of truth.
//
// The owner can change the ETH prices on-chain at any time (and PaymentsV3
// re-quotes them from the Chainlink ETH/USD feed on every call). A second copy
// in env drifts: it was 135x stale once already — env said $0.0074 while the
// contract charged $1.00, so every wallet reverted with InsufficientPayment.
// So we read the prices from chain, refresh them periodically, and use env only
// until the first successful read.
// ---------------------------------------------------------------------------
const PRICE_READ_ABI = [
  // V3 (USD-pegged, oracle-derived) — preferred when the contract has them
  "function quotePaidGameWei() view returns (uint256)",
  "function quoteSaveLeaderboardWei() view returns (uint256)",
  // V2 (fixed wei in storage)
  "function paidGamePriceWei() view returns (uint256)",
  "function saveLeaderboardPriceWei() view returns (uint256)"
];
const PRICE_REFRESH_MS = Number(process.env.PRICE_REFRESH_MS || 5 * 60 * 1000);
const livePrices = {
  paidGameWei: PAID_GAME_PRICE_WEI,
  saveLeaderboardWei: SAVE_LEADERBOARD_PRICE_WEI,
  fromChain: false,
  updatedAt: 0
};

async function refreshOnChainPrices() {
  if (!PAYMENTS_CONTRACT) return;
  try {
    const [paid, save] = await withRpcFallback(async (provider) => {
      const c = new ethers.Contract(PAYMENTS_CONTRACT, PRICE_READ_ABI, provider);
      // V3 first; a V2 contract has no quote* functions and the call reverts.
      const readPaid = c.quotePaidGameWei().catch(() => c.paidGamePriceWei());
      const readSave = c.quoteSaveLeaderboardWei().catch(() => c.saveLeaderboardPriceWei());
      return Promise.all([readPaid, readSave]);
    });
    if (paid > 0n && save > 0n) {
      livePrices.paidGameWei = BigInt(paid);
      livePrices.saveLeaderboardWei = BigInt(save);
      livePrices.fromChain = true;
      livePrices.updatedAt = Date.now();
    }
  } catch (e) {
    // Keep the last known good prices — never fall back to a stale env value
    // once a real on-chain price has been read.
    console.warn("[prices] on-chain refresh failed:", e.message);
  }
}

// Read the first `count` uint256 words of a log's data. Reading words instead of
// decoding the whole tuple keeps verification working across contract versions:
// V3 adds a `priceWei` field after the ones we care about, and the leading
// fields (value / score) keep their position.
function readEventWords(data, count) {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  const out = [];
  for (let i = 0; i < count; i++) {
    const word = body.slice(i * 64, (i + 1) * 64);
    if (word.length < 64) throw new Error("event data too short");
    out.push(BigInt("0x" + word));
  }
  return out;
}

refreshOnChainPrices();
setInterval(refreshOnChainPrices, PRICE_REFRESH_MS).unref();

const VALID_COIN_PACKAGES = new Set([10, 20, 50, 100, 500, 1000, 5000]);
if (ALLOWED_ORIGIN === "*") {
  console.warn("⚠️  ALLOWED_ORIGIN is '*' — set a specific domain for production!");
}
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1); // Render terminates TLS at a proxy — trust X-Forwarded-For

// Lightweight in-memory rate limiter (single Render instance). Returns an
// Express middleware that allows `max` requests per `windowMs` per client IP.
function rateLimit({ windowMs, max, message = "Too many requests" }) {
  const hits = new Map(); // ip -> { count, resetAt }
  // Periodically drop stale buckets so the map can't grow unbounded.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of hits) if (b.resetAt <= now) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let b = hits.get(ip);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      hits.set(ip, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.set("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: message });
    }
    next();
  };
}

// Anonymous auth endpoints create DB rows / do RPC — throttle hard.
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: "Too many auth attempts" });
// RPC-heavy read endpoints — looser but still bounded.
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

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
    paidGamePriceWei: livePrices.paidGameWei.toString(),
    saveLeaderboardPriceWei: livePrices.saveLeaderboardWei.toString(),
    // false = the on-chain read hasn't succeeded yet and these are env values
    pricesFromChain: livePrices.fromChain,
    paymentsContract: PAYMENTS_CONTRACT || null,
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

app.post("/auth/nonce", authLimiter, async (req, res) => {
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

app.post("/auth/verify", authLimiter, async (req, res) => {
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
app.post("/auth/siwe-verify", authLimiter, async (req, res) => {
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

function sessionOptions(req) {
  const { characterId = 0, boardWidth = 750, gameVersion } = req.body || {};
  if (gameVersion !== VERSION) throw new Error('Please reload the game');
  if (!Number.isInteger(characterId) || characterId < 0 || characterId > 9) throw new Error('Invalid character');
  if (!Number.isFinite(boardWidth) || boardWidth < 300 || boardWidth > 2000) throw new Error('Invalid board width');
  const speedTesting = isAdminAddress(req.user.address);
  const speedTestTier = speedTesting ? Math.max(0, Math.min(10, Math.floor(Number(req.body.speedTestTier) || 0))) : 0;
  return {characterId, boardWidth, speedTesting, speedTestTier};
}

function sessionResponse(session) {
  return {ok: true, ...session, config: {frameMs: FRAME_MS}};
}

function gameRequestError(res, error) {
  const expected = new Set([
    'Please reload the game', 'Invalid character', 'Invalid board width', 'Invalid score',
    'Invalid frame count', 'Invalid input log', 'Unknown session', 'Session expired',
    'Session address mismatch', 'Score exceeds time limit', 'Score does not match replay',
    'Payments not configured', 'Transaction not found on chain', 'Transaction failed on-chain',
    'Payment event not found', 'Transaction already used', 'User not found',
    'Score has not synced yet', 'Score does not match payment', 'Score exceeds best_score',
    'Coins amount mismatch',
  ]);
  const known = expected.has(error.message);
  return res.status(known ? 400 : 503).json({ok: false,
    error: known ? error.message : 'Could not complete request. Please retry.'});
}

async function paymentLog(txHash, address, topics) {
  if (!PAYMENTS_CONTRACT) throw new Error('Payments not configured');
  let receipt;
  for (let i = 0; i < 5; i++) {
    try { receipt = await withRpcFallback(p => p.getTransactionReceipt(txHash)); } catch { /* RPC lag */ }
    if (receipt) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!receipt) throw new Error('Transaction not found on chain');
  if (receipt.status !== 1) throw new Error('Transaction failed on-chain');
  const playerTopic = '0x' + address.slice(2).padStart(64, '0');
  const log = receipt.logs.find(log => log.address.toLowerCase() === PAYMENTS_CONTRACT
    && topics.has(log.topics[0]) && log.topics[1]?.toLowerCase() === playerTopic);
  if (!log) throw new Error('Payment event not found');
  // An authentic event from the configured contract proves that its price
  // checks passed at execution. Today's oracle quote cannot invalidate it.
  return log;
}

const sessionStartLimiter = rateLimit({windowMs: 60000, max: 30});
const submitLimiter = rateLimit({windowMs: 60000, max: 120});

app.post("/api/session/start", requireAuth, sessionStartLimiter, async (req, res) => {
  try {
    const options = sessionOptions(req);
    const characterLevel = await getCharacterLevel(req.user.address, options.characterId);
    const session = await createSession({address: req.user.address, seed: randomSeed(), ttlMs: SESSION_TTL_MS,
      ...options, characterLevel});
    res.json(sessionResponse(session));
  } catch (error) {
    gameRequestError(res, error);
  }
});

app.post("/api/session/start-paid", requireAuth, sessionStartLimiter, async (req, res) => {
  const txHash = normalizeTxHash(req.body?.txHash);
  if (!txHash) return res.status(400).json({ok: false, error: 'Invalid txHash'});
  try {
    const options = sessionOptions(req);
    const result = await applyPayment(txHash, 'paid_game', req.user.address, async client => {
      await paymentLog(txHash, req.user.address, PAID_GAME_TOPICS);
      const characterLevel = await getCharacterLevel(req.user.address, options.characterId);
      const session = await createSession({address: req.user.address, seed: randomSeed(), ttlMs: SESSION_TTL_MS,
        paid: true, ...options, characterLevel}, client);
      return sessionResponse(session);
    });
    res.json(result);
  } catch (error) {
    console.error('start-paid:', error);
    gameRequestError(res, error);
  }
});

app.post("/api/session/submit", requireAuth, submitLimiter, async (req, res) => {
  const {sessionId, inputLog, reportedScore, frameCount, gameVersion} = req.body || {};
  if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return res.status(400).json({ok: false, error: 'Invalid sessionId'});
  }
  try {
    const result = await completeSession(sessionId, req.user.address, async (session, client) => {
      if (gameVersion !== VERSION || session.gameVersion !== VERSION) throw new Error('Please reload the game');
      if (!Number.isSafeInteger(reportedScore) || reportedScore < 0) throw new Error('Invalid score');
      const maxFrames = Math.floor((Date.now() - session.issuedAt) / FRAME_MS) + 5;
      if (!Number.isSafeInteger(frameCount) || frameCount > maxFrames) throw new Error('Score exceeds time limit');
      const replay = simulateRun({seed: session.seed, frameCount, inputEvents: inputLog, config: session});
      if (replay.score !== reportedScore || replay.frameCount !== frameCount) throw new Error('Score does not match replay');
      const charLevel = session.characterLevel;
      const scoreMultiplier = LEVEL_SCORE_MULTIPLIER[charLevel] || 1;
      const adjustedScore = Math.floor(replay.score * scoreMultiplier);
      const coinsAwarded = Math.floor(adjustedScore / 1000) * ((session.paid ? 5 : 1) + (LEVEL_COIN_BONUS[charLevel] || 0));
      const {rows} = await client.query(
        'UPDATE users SET coins = coins + $2, best_score = GREATEST(best_score, $3), updated_at = NOW() WHERE address = $1 RETURNING coins, best_score',
        [req.user.address, coinsAwarded, adjustedScore]);
      if (!rows.length) throw new Error('User not found');
      return {ok: true, finalScore: adjustedScore, rawScore: replay.score, coinsAwarded,
        coinBalance: rows[0].coins, bestScore: rows[0].best_score, charLevel, scoreMultiplier};
    });
    res.json(result);
  } catch (error) {
    console.error('submit:', error);
    gameRequestError(res, error);
  }
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
// Paid RPC (e.g. Ankr) is used ONLY for the leaderboard basename batch, which
// fires ~200 requests in a row every 12h. Falls back to RPC_URL then public.
const BASE_RPC_URL           = process.env.LEADERBOARD_RPC_URL || process.env.RPC_URL || "https://mainnet.base.org";

async function rpcCall(to, data, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to, data }, "latest"],
        }),
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw new Error(`rpc ${res.status}`);
      }
      const json = await res.json();
      if (json.error) {
        if (json.error.code === -32005 && attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw new Error(`rpc error ${json.error.code}: ${json.error.message}`);
      }
      return json.result;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}

// Returns { ok: true, name } if decoded (name may be ""), { ok: false } on parse fail
function decodeAbiString(hexResult) {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return { ok: false };
  const hex = hexResult.slice(2);
  const strOffset = parseInt(hex.slice(0, 64), 16) * 2;
  const strLen    = parseInt(hex.slice(strOffset, strOffset + 64), 16);
  if (strLen === 0) return { ok: true, name: "" };
  if (strLen > 256) return { ok: false };
  const strHex = hex.slice(strOffset + 64, strOffset + 64 + strLen * 2);
  try {
    const name = new TextDecoder().decode(new Uint8Array(strHex.match(/.{2}/g).map(b => parseInt(b, 16))));
    return { ok: true, name };
  } catch { return { ok: false }; }
}

async function resolveBaseName(address) {
  if (!address) return null;
  const key = address.toLowerCase();
  const cached = baseNameCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < BASE_NAME_TTL_MS) return cached.name;

  let name = null;
  let lastError = null;
  let rateLimited = false;
  try {
    const paddedAddr = key.slice(2).padStart(64, "0");
    const reverseNode = await rpcCall(BASE_REVERSE_REGISTRAR, "0xbffbe61c" + paddedAddr);
    if (!reverseNode || reverseNode === "0x" || reverseNode.length < 66) {
      lastError = `bad node: ${reverseNode}`;
    } else {
      const nameResult = await rpcCall(BASE_L2_RESOLVER, "0x691f3431" + reverseNode.slice(2));
      if (!nameResult || nameResult === "0x") {
        lastError = `empty name result`;
      } else {
        const decoded = decodeAbiString(nameResult);
        if (!decoded.ok) lastError = `decode failed (len=${nameResult.length})`;
        // Defense-in-depth: only accept basename-shaped strings. The reverse
        // record is attacker-controlled, so reject anything with characters
        // that don't belong in an ENS/Basename to keep HTML/script payloads
        // out of the leaderboard entirely (frontend also escapes on render).
        else if (decoded.name && decoded.name.includes(".") && /^[a-zA-Z0-9.\-_]+$/.test(decoded.name)) {
          name = decoded.name;
        }
        // else: empty string = no basename set, not an error
      }
    }
  } catch (e) {
    lastError = e.message;
    if (/429|rate/i.test(e.message)) rateLimited = true;
  }

  if (!name && lastError) {
    console.warn(`[basename] ${key} -> null (${lastError})`);
  }

  // Only cache on success or definitive "no name" — don't cache rate-limit failures
  if (!rateLimited) baseNameCache.set(key, { name, fetchedAt: Date.now() });
  return name;
}

// Periodic leaderboard snapshot: refresh runs once per 12h, basename
// resolution amortized across the whole interval. Client gets cached
// snapshot instantly.
const LEADERBOARD_REFRESH_MS = 24 * 60 * 60 * 1000;
const LEADERBOARD_LIMIT = 100;
// Tournament: standings freeze at the deadline and stay frozen for the prize
// week so late runs can't change the winners shown on the plaque.
const TOURNAMENT_END_MS = Date.parse("2026-06-22T00:00:00+03:00");
const TOURNAMENT_WINNERS_END_MS = TOURNAMENT_END_MS + 7 * 24 * 60 * 60 * 1000;
let leaderboardSnapshot = {
  entries: [],
  refreshedAt: null,
  nextRefreshAt: null,
  refreshing: false,
};

async function refreshLeaderboard(opts = {}) {
  if (leaderboardSnapshot.refreshing) return;
  // Freeze the snapshot during the prize week (deadline -> +7d). `force` is the
  // scheduled deadline capture; an empty snapshot (e.g. after a restart) is
  // repopulated so the board is never blank.
  const nowMs = Date.now();
  const inWinnersWindow = nowMs >= TOURNAMENT_END_MS && nowMs < TOURNAMENT_WINNERS_END_MS;
  if (!opts.force && inWinnersWindow && leaderboardSnapshot.entries.length > 0) return;
  leaderboardSnapshot.refreshing = true;
  const startedAt = Date.now();
  try {
    const { rows } = await require("./shared/db").query(
      `SELECT address, leaderboard_score FROM users WHERE leaderboard_score > 0
       ORDER BY leaderboard_score DESC LIMIT ${LEADERBOARD_LIMIT + 25}`
    );
    const filtered = rows.filter(r => !isAdminAddress(r.address)).slice(0, LEADERBOARD_LIMIT);

    const entries = [];
    let withNames = 0;
    for (const r of filtered) {
      const name = await resolveBaseName(r.address);
      if (name) withNames++;
      entries.push({
        rank: entries.length + 1,
        address: r.address,
        name,
        score: Number(r.leaderboard_score),
      });
      // Small gap to stay polite to public Base RPC
      await new Promise(rr => setTimeout(rr, 50));
    }

    const now = Date.now();
    leaderboardSnapshot.entries = entries;
    leaderboardSnapshot.refreshedAt = now;
    leaderboardSnapshot.nextRefreshAt = now + LEADERBOARD_REFRESH_MS;
    console.log(`[leaderboard] snapshot: ${entries.length} entries, ${withNames} basenames, took ${Date.now() - startedAt}ms`);
  } catch (e) {
    console.error("[leaderboard] refresh failed:", e.message);
  } finally {
    leaderboardSnapshot.refreshing = false;
  }
}

app.get("/api/leaderboard", (req, res) => {
  res.json({
    ok: true,
    entries: leaderboardSnapshot.entries,
    refreshedAt: leaderboardSnapshot.refreshedAt,
    nextRefreshAt: leaderboardSnapshot.nextRefreshAt,
    refreshing: leaderboardSnapshot.refreshing,
  });
});

// Preflight avoids charging for an unsynced score or one already on the board.
app.post('/api/leaderboard/prepare', requireAuth, async (req, res) => {
  const score = req.body?.score;
  if (!Number.isSafeInteger(score) || score < 1) return res.status(400).json({ok: false, error: 'Invalid score'});
  try {
    if (!PAYMENTS_CONTRACT) throw new Error('Payments not configured');
    const {rows} = await require('./shared/db').query('SELECT best_score, leaderboard_score FROM users WHERE address = $1', [req.user.address]);
    if (!rows.length) throw new Error('User not found');
    if (score > Number(rows[0].best_score)) throw new Error('Score has not synced yet');
    res.json({ok: true, alreadySaved: score <= Number(rows[0].leaderboard_score), paymentsContract: PAYMENTS_CONTRACT});
  } catch (error) { gameRequestError(res, error); }
});

app.post('/api/leaderboard/save', requireAuth, async (req, res) => {
  const score = req.body?.score;
  const txHash = normalizeTxHash(req.body?.txHash);
  if (!Number.isSafeInteger(score) || score < 1) return res.status(400).json({ok: false, error: 'Invalid score'});
  if (!txHash) return res.status(400).json({ok: false, error: 'Payment txHash required'});
  try {
    const result = await applyPayment(txHash, 'leaderboard_save', req.user.address, async client => {
      const log = await paymentLog(txHash, req.user.address, LEADERBOARD_SAVED_TOPICS);
      const [paidScore] = readEventWords(log.data, 1);
      if (paidScore !== BigInt(score)) throw new Error('Score does not match payment');
      const {rows} = await client.query('SELECT best_score, leaderboard_score FROM users WHERE address = $1 FOR UPDATE', [req.user.address]);
      if (!rows.length) throw new Error('User not found');
      if (score > Number(rows[0].best_score)) throw new Error('Score exceeds best_score');
      await client.query('UPDATE users SET leaderboard_score = GREATEST(leaderboard_score, $2), updated_at = NOW() WHERE address = $1', [req.user.address, score]);
      return {ok: true, updated: score > Number(rows[0].leaderboard_score), leaderboardScore: Math.max(score, Number(rows[0].leaderboard_score))};
    });
    res.json(result);
  } catch (error) {
    console.error('leaderboard/save:', error);
    gameRequestError(res, error);
  }
});

// Manual refresh endpoint (admin-only) for forced updates
app.post("/api/admin/leaderboard/refresh", requireAuth, async (req, res) => {
  if (!isAdminAddress(req.user.address)) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }
  // force so admin can refresh even while the snapshot is frozen for the prize week
  refreshLeaderboard({ force: true }).catch(() => {});
  res.json({ ok: true, message: "Refresh started" });
});

// Kick off first refresh on startup, then every 12h
setTimeout(() => refreshLeaderboard(), 5000);
setInterval(() => refreshLeaderboard(), LEADERBOARD_REFRESH_MS).unref();

// One-shot: refresh exactly at the tournament deadline (00:00 22nd GMT+3) so the
// snapshot captures the final standings, which then stay frozen for the week.
{
  const msToEnd = TOURNAMENT_END_MS - Date.now();
  // < 24 days keeps the delay under setInterval/Timeout's 32-bit ceiling.
  if (msToEnd > 0 && msToEnd < 24 * 24 * 60 * 60 * 1000) {
    setTimeout(() => {
      console.log("[leaderboard] tournament deadline — capturing final standings");
      refreshLeaderboard({ force: true }).catch(() => {});
    }, msToEnd).unref();
  }
}

app.get("/api/checkin/status", readLimiter, requireAuth, async (req, res) => {
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
  const { txHash } = req.body || {};

  // The free character is ALWAYS character 0 (Vitalik). The client used to be
  // able to pass any characterId here and unlock a premium character for free.
  const FREE_CHARACTER_ID = 0;

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
    await addOwnedCharacter(req.user.address, FREE_CHARACTER_ID);

    const updatedUser = await getOrCreateUser(req.user.address);

    res.json({
      ok: true,
      txHash,
      hasFreeMint: true,
      ownedCharacters: updatedUser.owned_characters || [FREE_CHARACTER_ID]
    });
  } catch (err) {
    console.error("Claim free error:", err);
    res.status(500).json({ ok: false, error: "Failed to mark claim" });
  }
});

// Buy coins with USDC
app.post("/api/shop/buy-coins", requireAuth, async (req, res) => {
  const coins = Number(req.body?.coins);
  const txHash = normalizeTxHash(req.body?.txHash);
  if (!VALID_COIN_PACKAGES.has(coins) || !txHash) return res.status(400).json({ok: false, error: 'Invalid purchase'});
  try {
    const result = await applyPayment(txHash, 'coin_purchase', req.user.address, async client => {
      const log = await paymentLog(txHash, req.user.address, COINS_PURCHASED_TOPICS);
      const [coinsAmount] = readEventWords(log.data, 1);
      if (coinsAmount !== BigInt(coins)) throw new Error('Coins amount mismatch');
      const {rows} = await client.query('UPDATE users SET coins = coins + $2, updated_at = NOW() WHERE address = $1 RETURNING coins', [req.user.address, coins]);
      if (!rows.length) throw new Error('User not found');
      return {ok: true, coinsAdded: coins, newBalance: rows[0].coins};
    });
    res.json(result);
  } catch (error) {
    console.error('buy-coins:', error);
    gameRequestError(res, error);
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
  if (isNaN(characterId) || !CHARACTER_PREVIEWS[characterId]) {
    res.status(404).end();
    return;
  }
  const spritePath = path.join(__dirname, "sprites", "previews", CHARACTER_PREVIEWS[characterId]);
  if (!fs.existsSync(spritePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(spritePath, { headers: { "Cache-Control": SPRITE_CACHE_CONTROL } });
});

// Get sprite for owned character (returns image file)
app.get("/api/sprites/:characterId", requireAuth, async (req, res) => {
  const characterId = parseInt(req.params.characterId);
  
  if (isNaN(characterId) || !CHARACTER_SPRITES[characterId]) {
    res.status(404).json({ ok: false, error: "Character not found" });
    return;
  }
  
  try {
    const requestedOwner = String(req.query.owner || "").toLowerCase();
    if (requestedOwner && requestedOwner !== req.user.address) {
      res.status(403).json({ ok: false, error: "Sprite owner mismatch" });
      return;
    }

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
    
    res.sendFile(spritePath, {
      headers: {
        "Cache-Control": requestedOwner ? PRIVATE_SPRITE_CACHE_CONTROL : "private, no-store",
      },
    });
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
        sprites[charId] = `/api/sprites/${charId}?owner=${encodeURIComponent(req.user.address)}&v=1`;
      }
    }
    
    // Add character 0 if has free mint
    if (user.has_claimed_free && CHARACTER_SPRITES[0]) {
      sprites[0] = `/api/sprites/0?owner=${encodeURIComponent(req.user.address)}&v=1`;
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
setInterval(runCheckinReminderJob, 60 * 60 * 1000).unref();
setInterval(() => cleanupSessions().catch(console.error), 60 * 1000).unref();

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
