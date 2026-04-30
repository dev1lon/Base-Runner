const { query } = require("../../shared/db");
const { getOrCreateUser, updateUser, addOwnedCharacter } = require("../user/userRepo");
const crypto = require("crypto");
const { ethers } = require("ethers");

// Configuration
const SIGNATURE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS || "";
const CHAIN_ID = process.env.CHAIN_ID || "84532"; // Base Sepolia
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY || "";

/**
 * Get all available characters
 */
async function getCharacters() {
  const result = await query(
    `SELECT * FROM shop_characters WHERE active = TRUE ORDER BY character_id`
  );
  return result.rows;
}

/**
 * Get single character by ID
 */
async function getCharacter(characterId) {
  const result = await query(
    `SELECT * FROM shop_characters WHERE character_id = $1`,
    [characterId]
  );
  return result.rows[0] || null;
}

/**
 * Add a new character (admin only)
 */
async function addCharacter({ characterId, name, description, imageUrl, metadataUri, price, maxSupply }) {
  const result = await query(
    `INSERT INTO shop_characters (character_id, name, description, image_url, metadata_uri, price, max_supply)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [characterId, name, description, imageUrl, metadataUri, price, maxSupply || 0]
  );
  return result.rows[0];
}

/**
 * Start a purchase - reserve coins and generate signature
 */
async function startPurchase(address, characterId) {
  // Get user and character
  const user = await getOrCreateUser(address);
  const character = await getCharacter(characterId);
  
  if (!character) {
    return { ok: false, error: "Character not found" };
  }
  
  if (!character.active) {
    return { ok: false, error: "Character not available" };
  }
  
  // Check if user has enough coins
  const availableCoins = await getAvailableCoins(address);
  if (availableCoins < character.price) {
    return { ok: false, error: "Not enough coins", required: character.price, available: availableCoins };
  }
  
  // Check for existing pending purchase
  const existingPending = await query(
    `SELECT * FROM pending_purchases 
     WHERE address = $1 AND status = 'pending' AND expiry > NOW()`,
    [address.toLowerCase()]
  );
  
  if (existingPending.rows.length > 0) {
    // Cancel existing pending purchase first
    await cancelPurchase(address, existingPending.rows[0].nonce);
  }
  
  // Generate nonce and expiry
  const nonce = "0x" + crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + SIGNATURE_EXPIRY_MS);
  const expiryTimestamp = Math.floor(expiry.getTime() / 1000);
  
  // Generate signature
  let signature = null;
  if (SIGNER_PRIVATE_KEY && NFT_CONTRACT_ADDRESS) {
    signature = await generateMintSignature(
      address,
      characterId,
      nonce,
      expiryTimestamp
    );
  }
  
  // Create pending purchase (reserve coins)
  await query(
    `INSERT INTO pending_purchases (address, character_id, coins_reserved, nonce, signature, expiry, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [address.toLowerCase(), characterId, character.price, nonce, signature, expiry]
  );
  
  return {
    ok: true,
    characterId,
    price: character.price,
    nonce,
    expiry: expiryTimestamp,
    signature,
    contractAddress: NFT_CONTRACT_ADDRESS
  };
}

/**
 * Confirm a purchase after successful mint
 */
async function confirmPurchase(address, nonce, txHash) {
  // Find pending purchase
  const result = await query(
    `SELECT * FROM pending_purchases 
     WHERE address = $1 AND nonce = $2 AND status = 'pending'`,
    [address.toLowerCase(), nonce]
  );
  
  if (result.rows.length === 0) {
    return { ok: false, error: "Pending purchase not found" };
  }
  
  const pending = result.rows[0];
  
  // Check if expired
  if (new Date(pending.expiry) < new Date()) {
    await cancelPurchase(address, nonce);
    return { ok: false, error: "Purchase expired" };
  }
  
  // Atomic coin deduction — prevents race condition
  const { deductCoins } = require("../user/userRepo");
  const deducted = await deductCoins(address, pending.coins_reserved);
  if (!deducted) {
    await cancelPurchase(address, nonce);
    return { ok: false, error: "Insufficient coins" };
  }

  // Update pending purchase status
  await query(
    `UPDATE pending_purchases
     SET status = 'completed', tx_hash = $1, completed_at = NOW()
     WHERE id = $2`,
    [txHash, pending.id]
  );

  // Add character to owned_characters
  await addOwnedCharacter(address, pending.character_id);

  const updatedUser = await getOrCreateUser(address);

  return {
    ok: true,
    coinsDeducted: pending.coins_reserved,
    newBalance: updatedUser.coins,
    ownedCharacters: updatedUser.owned_characters || []
  };
}

/**
 * Cancel a pending purchase (return reserved coins)
 */
async function cancelPurchase(address, nonce) {
  const result = await query(
    `UPDATE pending_purchases 
     SET status = 'cancelled', completed_at = NOW()
     WHERE address = $1 AND nonce = $2 AND status = 'pending'
     RETURNING *`,
    [address.toLowerCase(), nonce]
  );
  
  return { ok: result.rowCount > 0 };
}

/**
 * Get available coins (total - reserved in pending purchases)
 */
async function getAvailableCoins(address) {
  const user = await getOrCreateUser(address);
  
  // Get total reserved in pending purchases
  const pendingResult = await query(
    `SELECT COALESCE(SUM(coins_reserved), 0) as reserved
     FROM pending_purchases 
     WHERE address = $1 AND status = 'pending' AND expiry > NOW()`,
    [address.toLowerCase()]
  );
  
  const reserved = parseInt(pendingResult.rows[0].reserved) || 0;
  return Math.max(0, user.coins - reserved);
}

/**
 * Get user's inventory
 */
async function getUserInventory(address) {
  const result = await query(
    `SELECT ui.*, sc.name, sc.description, sc.image_url
     FROM user_inventory ui
     LEFT JOIN shop_characters sc ON sc.character_id = ui.character_id
     WHERE ui.address = $1
     ORDER BY ui.minted_at DESC`,
    [address.toLowerCase()]
  );
  return result.rows;
}

/**
 * Cleanup expired pending purchases
 */
async function cleanupExpiredPurchases() {
  await query(
    `UPDATE pending_purchases 
     SET status = 'expired', completed_at = NOW()
     WHERE status = 'pending' AND expiry < NOW()`
  );
}

/**
 * Generate signature for minting
 */
async function generateMintSignature(userAddress, characterId, nonce, expiryTimestamp) {
  if (!SIGNER_PRIVATE_KEY) {
    return null;
  }
  
  const wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY);
  
  // Create message hash matching contract's verification
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256", "uint256", "address"],
    [
      userAddress,
      characterId,
      nonce,
      expiryTimestamp,
      parseInt(CHAIN_ID),
      NFT_CONTRACT_ADDRESS
    ]
  );
  
  // Sign the message
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  
  return signature;
}

// Run cleanup every minute
setInterval(cleanupExpiredPurchases, 60 * 1000);

module.exports = {
  getCharacters,
  getCharacter,
  addCharacter,
  startPurchase,
  confirmPurchase,
  cancelPurchase,
  getAvailableCoins,
  getUserInventory,
  cleanupExpiredPurchases
};
