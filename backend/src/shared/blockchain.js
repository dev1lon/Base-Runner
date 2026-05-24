/**
 * Blockchain service for interacting with GameCoin contract
 */
const { ethers } = require("ethers");

// Contract ABI (only functions we need)
const GAME_COIN_ABI = [
    "function mint(address to, uint256 amount) external",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function minters(address) external view returns (bool)",
    "function paused() external view returns (bool)",
    "function getRemainingDailyMint(address account) external view returns (uint256)"
];

// RPC URLs with fallbacks
const RPC_URLS = [
    process.env.RPC_URL || "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.blockpi.network/v1/rpc/public",
    "https://sepolia.base.org"
];

const GAME_COIN_ADDRESS = process.env.GAME_COIN_ADDRESS || "";
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || "";

let provider = null;
let minterWallet = null;
let gameCoinContract = null;
let currentRpcIndex = 0;
let gameCoinDecimals = 0;

/**
 * Try to connect to RPC with fallback
 */
async function getWorkingProvider() {
    for (let i = 0; i < RPC_URLS.length; i++) {
        const rpcUrl = RPC_URLS[(currentRpcIndex + i) % RPC_URLS.length];
        try {
            const testProvider = new ethers.JsonRpcProvider(rpcUrl);
            // Test the connection
            await testProvider.getBlockNumber();
            currentRpcIndex = (currentRpcIndex + i) % RPC_URLS.length;
            return testProvider;
        } catch (err) {
            console.warn(`RPC ${rpcUrl} failed, trying next...`);
        }
    }
    throw new Error("All RPC endpoints failed");
}

/**
 * Initialize blockchain connection
 */
async function initBlockchain() {
    if (!GAME_COIN_ADDRESS || !MINTER_PRIVATE_KEY) {
        console.warn("⚠️ Blockchain not configured - GAME_COIN_ADDRESS or MINTER_PRIVATE_KEY missing");
        return false;
    }
    
    try {
        provider = await getWorkingProvider();
        minterWallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);
        gameCoinContract = new ethers.Contract(GAME_COIN_ADDRESS, GAME_COIN_ABI, minterWallet);
        gameCoinDecimals = await gameCoinContract.decimals().catch(() => 0);
        
        console.log(`✅ Blockchain initialized`);
        console.log(`   RPC: ${RPC_URLS[currentRpcIndex]}`);
        console.log(`   GameCoin: ${GAME_COIN_ADDRESS}`);
        console.log(`   Minter: ${minterWallet.address}`);
        
        return true;
    } catch (err) {
        console.error("❌ Failed to initialize blockchain:", err.message);
        return false;
    }
}

/**
 * Reconnect to blockchain (try next RPC)
 */
async function reconnectBlockchain() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
    return initBlockchain();
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
 * @param {number} amount - Amount of coins to mint (in whole coins, not wei)
 * @param {number} retries - Number of retries on failure
 * @returns {Promise<{success: boolean, txHash?: string, error?: string}>}
 */
// Parallel mints with safe nonce management:
// Only the nonce *reservation* is serialized (sub-ms), not the actual
// tx send/wait. Each call atomically claims `nextNonce` and increments.
// On error we re-sync from chain to avoid a stuck-stale state.
let nextNonce = null;
let nonceLock = Promise.resolve();

async function reserveNonce() {
    let release;
    const next = new Promise(r => { release = r; });
    const prev = nonceLock;
    nonceLock = next;
    await prev;
    try {
        if (nextNonce === null) {
            nextNonce = await minterWallet.getNonce();
        }
        const reserved = nextNonce;
        nextNonce += 1;
        return reserved;
    } finally {
        release();
    }
}

async function _mintCoinsInner(to, amount, retries) {
    if (!to || amount <= 0) return { success: false, error: "Invalid parameters" };
    const amountUnits = ethers.parseUnits(String(amount), gameCoinDecimals);

    for (let attempt = 0; attempt <= retries; attempt++) {
        let reservedNonce;
        try {
            const isPaused = await gameCoinContract.paused().catch(() => false);
            if (isPaused) return { success: false, error: "Contract paused" };

            const isMinter = await gameCoinContract.minters(minterWallet.address);
            if (!isMinter) return { success: false, error: "Not authorized minter" };

            reservedNonce = await reserveNonce();
            console.log(`Minting ${amount} GC to ${to} (attempt ${attempt + 1}, nonce ${reservedNonce})`);
            const tx = await gameCoinContract.mint(to, amountUnits, { nonce: reservedNonce });
            console.log(`Tx sent: ${tx.hash}`);

            const receipt = await tx.wait();
            console.log(`✅ Minted ${amount} GC to ${to} in tx ${receipt.hash}`);

            return { success: true, txHash: receipt.hash, blockNumber: receipt.blockNumber, amount };
        } catch (err) {
            console.error(`❌ Mint attempt ${attempt + 1} failed (nonce ${reservedNonce}):`, err.message);
            // Re-sync nonce so a bad nonce doesn't poison subsequent reservations
            nextNonce = await minterWallet.getNonce().catch(() => null);
            if (attempt < retries && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT')) {
                await reconnectBlockchain();
            } else if (attempt === retries) {
                return { success: false, error: err.message };
            }
        }
    }
    return { success: false, error: "All retry attempts failed" };
}

async function mintCoins(to, amount, retries = 2) {
    if (!isBlockchainReady()) {
        return { success: false, error: "Blockchain not configured" };
    }
    return _mintCoinsInner(to, amount, retries);
}

/**
 * Get user's on-chain balance (in whole coins, not wei)
 * @param {string} address - User address
 * @returns {Promise<number>}
 */
async function getOnChainBalance(address) {
    if (!isBlockchainReady()) {
        return 0;
    }
    
    try {
        const balance = await gameCoinContract.balanceOf(address);
        return Number(ethers.formatUnits(balance, gameCoinDecimals));
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
initBlockchain().catch(err => {
    console.error("Failed to init blockchain:", err.message);
});

module.exports = {
    initBlockchain,
    reconnectBlockchain,
    isBlockchainReady,
    mintCoins,
    getOnChainBalance,
    getMinterBalance
};
