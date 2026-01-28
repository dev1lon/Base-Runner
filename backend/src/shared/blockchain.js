/**
 * Blockchain service for interacting with GameCoin contract
 */
const { ethers } = require("ethers");

// Contract ABI (only functions we need)
const GAME_COIN_ABI = [
    "function mint(address to, uint256 amount) external",
    "function balanceOf(address account) external view returns (uint256)",
    "function minters(address) external view returns (bool)",
    "function paused() external view returns (bool)",
    "function getRemainingDailyMint(address account) external view returns (uint256)"
];

// Environment variables
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const GAME_COIN_ADDRESS = process.env.GAME_COIN_ADDRESS || "";
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || "";

let provider = null;
let minterWallet = null;
let gameCoinContract = null;

/**
 * Initialize blockchain connection
 */
function initBlockchain() {
    if (!GAME_COIN_ADDRESS || !MINTER_PRIVATE_KEY) {
        console.warn("⚠️ Blockchain not configured - GAME_COIN_ADDRESS or MINTER_PRIVATE_KEY missing");
        return false;
    }
    
    try {
        provider = new ethers.JsonRpcProvider(RPC_URL);
        minterWallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);
        gameCoinContract = new ethers.Contract(GAME_COIN_ADDRESS, GAME_COIN_ABI, minterWallet);
        
        console.log(`✅ Blockchain initialized`);
        console.log(`   RPC: ${RPC_URL}`);
        console.log(`   GameCoin: ${GAME_COIN_ADDRESS}`);
        console.log(`   Minter: ${minterWallet.address}`);
        
        return true;
    } catch (err) {
        console.error("❌ Failed to initialize blockchain:", err.message);
        return false;
    }
}

/**
 * Check if blockchain is ready
 */
function isBlockchainReady() {
    return !!(provider && minterWallet && gameCoinContract);
}

/**
 * Mint coins to user
 * @param {string} to - Recipient address
 * @param {number} amount - Amount of coins to mint
 * @returns {Promise<{success: boolean, txHash?: string, error?: string}>}
 */
async function mintCoins(to, amount) {
    if (!isBlockchainReady()) {
        console.warn("Blockchain not ready, skipping on-chain mint");
        return { success: false, error: "Blockchain not configured" };
    }
    
    if (!to || amount <= 0) {
        return { success: false, error: "Invalid parameters" };
    }
    
    try {
        // Check if contract is paused
        const isPaused = await gameCoinContract.paused();
        if (isPaused) {
            console.warn("GameCoin contract is paused");
            return { success: false, error: "Contract paused" };
        }
        
        // Check if we're an authorized minter
        const isMinter = await gameCoinContract.minters(minterWallet.address);
        if (!isMinter) {
            console.error("Backend wallet is not an authorized minter!");
            return { success: false, error: "Not authorized minter" };
        }
        
        // Check daily limit
        const remaining = await gameCoinContract.getRemainingDailyMint(to);
        if (BigInt(amount) > remaining) {
            console.warn(`Daily limit exceeded for ${to}. Remaining: ${remaining}, Requested: ${amount}`);
            return { success: false, error: "Daily limit exceeded" };
        }
        
        // Execute mint
        console.log(`Minting ${amount} coins to ${to}...`);
        const tx = await gameCoinContract.mint(to, amount);
        console.log(`Transaction sent: ${tx.hash}`);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`✅ Minted ${amount} coins to ${to} in tx ${receipt.hash}`);
        
        return { 
            success: true, 
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber
        };
    } catch (err) {
        console.error(`❌ Failed to mint coins:`, err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's on-chain balance
 * @param {string} address - User address
 * @returns {Promise<number>}
 */
async function getOnChainBalance(address) {
    if (!isBlockchainReady()) {
        return 0;
    }
    
    try {
        const balance = await gameCoinContract.balanceOf(address);
        return Number(balance);
    } catch (err) {
        console.error("Failed to get balance:", err.message);
        return 0;
    }
}

/**
 * Get minter wallet balance (for monitoring)
 * @returns {Promise<string>} Balance in ETH
 */
async function getMinterBalance() {
    if (!isBlockchainReady()) {
        return "0";
    }
    
    try {
        const balance = await provider.getBalance(minterWallet.address);
        return ethers.formatEther(balance);
    } catch (err) {
        console.error("Failed to get minter balance:", err.message);
        return "0";
    }
}

// Initialize on module load
initBlockchain();

module.exports = {
    initBlockchain,
    isBlockchainReady,
    mintCoins,
    getOnChainBalance,
    getMinterBalance
};
