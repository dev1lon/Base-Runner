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
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 60 * 60 * 1000); // 1 hour
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
    hasFreeMint: result.user.has_claimed_free || false,
    ownedCharacters: result.user.owned_characters || [],
    selectedCharacter: result.user.selected_character || 0
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
  // Session expiration check disabled
  // if (session.expiresAt <= Date.now()) {
  //   res.status(400).json({ ok: false, error: "Session expired" });
  //   return;
  // }

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

  // Anti-cheat: maxScore check (time-based limit)
  console.log("📊 Score info:", { reported, maxScore, gameDurationMs });

  const finalScore = Math.min(reported, maxScore);
  const coinsAwarded = Math.floor(finalScore / 1000);
  console.log("💰 Awarding:", { finalScore, coinsAwarded, address: addressNorm });
  const result = await applyScore(addressNorm, finalScore, coinsAwarded);
  markSessionUsed(sessionId);

  res.json({
    ok: true,
    finalScore,
    maxScore,
    coinsAwarded,
    coinBalance: result ? result.coins : 0,
    bestScore: result ? result.best_score : finalScore,
    // On-chain mint info
    onChainMinted: result?.onChainMinted || 0,
    mintTxHash: result?.mintResult?.txHash || null
  });
});

app.get("/api/user/me", requireAuth, async (req, res) => {
  let user = await getOrCreateUser(req.user.address);
  
  // Auto-sync from blockchain if DB shows no free mint but user might have minted
  if (!user.has_claimed_free) {
    try {
      const synced = await syncUserFromBlockchain(req.user.address);
      if (synced) {
        user = await getOrCreateUser(req.user.address);
      }
    } catch (e) {
      console.warn("Failed to sync from blockchain:", e.message);
    }
  }
  
  res.json({
    ok: true,
    address: user.address,
    coinBalance: user.coins,
    bestScore: user.best_score,
    hasFreeMint: user.has_claimed_free || false,
    ownedCharacters: user.owned_characters || [],
    selectedCharacter: user.selected_character || 0
  });
});

// Sync user data from blockchain (for users who minted before DB update)
async function syncUserFromBlockchain(address) {
  const { ethers } = require("ethers");
  const { updateUser, addOwnedCharacter } = require("./modules/user/userRepo");
  
  const NFT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
  if (!NFT_ADDRESS) return false;
  
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
  
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const nftAbi = [
      "function hasClaimedFreeMint(address) view returns (bool)",
      "function getOwnedCharacterList(address) view returns (uint8[])"
    ];
    const contract = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
    
    const hasFreeMint = await contract.hasClaimedFreeMint(address);
    
    if (hasFreeMint) {
      await updateUser(address, { has_claimed_free: true });
      
      // Get owned characters
      try {
        const owned = await contract.getOwnedCharacterList(address);
        for (const charId of owned) {
          await addOwnedCharacter(address, Number(charId));
        }
      } catch (e) {
        // If getOwnedCharacterList fails, at least add character 0
        await addOwnedCharacter(address, 0);
      }
      
      console.log(`✅ Synced user ${address} from blockchain: hasFreeMint=${hasFreeMint}`);
      return true;
    }
    
    return false;
  } catch (err) {
    console.error("Blockchain sync error:", err.message);
    return false;
  }
}

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
  const { txHash, characterId = 0 } = req.body || {};
  
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

// Record character purchase (after successful on-chain transaction)
app.post("/api/shop/record-purchase", requireAuth, async (req, res) => {
  const { txHash, characterId, price } = req.body || {};
  
  if (characterId === undefined || !price) {
    res.status(400).json({ ok: false, error: "Missing characterId or price" });
    return;
  }
  
  try {
    const { addOwnedCharacter, deductCoins, addCoins } = require("./modules/user/userRepo");
    const user = await getOrCreateUser(req.user.address);
    
    // Check if already owns
    if (user.owned_characters && user.owned_characters.includes(characterId)) {
      res.status(400).json({ ok: false, error: "Already owns this character" });
      return;
    }
    
    // Deduct coins from DB
    const deducted = await deductCoins(req.user.address, price);
    if (!deducted) {
      res.status(400).json({ ok: false, error: "Insufficient coins" });
      return;
    }
    
    // Add character to owned
    await addOwnedCharacter(req.user.address, characterId);
    
    const updatedUser = await getOrCreateUser(req.user.address);
    
    res.json({
      ok: true,
      txHash,
      coinBalance: updatedUser.coins,
      ownedCharacters: updatedUser.owned_characters || []
    });
  } catch (err) {
    console.error("Record purchase error:", err);
    res.status(500).json({ ok: false, error: "Failed to record purchase" });
  }
});

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
