//=============================================================================
// SIMPLE SCALING SYSTEM - based on canvas height
//=============================================================================
let board;

// Base canvas dimensions
const BASE_BOARD_WIDTH = 750;
const BASE_BOARD_HEIGHT = 400;

// Current dimensions
let boardWidth = BASE_BOARD_WIDTH;
let boardHeight = BASE_BOARD_HEIGHT;

// Scale factor (based on height)
let gameScale = 1;

// Platform (PNG sprite)
let platformImg = null;

// Platform position (ratio-based)
const PLATFORM_Y_RATIO = 0.75; // Platform at 75% of canvas height
const PLATFORM_HEIGHT = 10;

let platform = {
    x: 0,
    y: 0,
    width: 0,
    height: PLATFORM_HEIGHT
};

// Ground baseline
let groundY = Math.round(BASE_BOARD_HEIGHT * PLATFORM_Y_RATIO);

// Debug
const DEBUG_SHOW_GROUND_LINE = false;

//=============================================================================
// BASE SPRITE SIZES (at scale 1.0)
//=============================================================================
const BASE_COIN_SIZE = 20;
const BASE_PLAYER_HEIGHT = 80; // 2x coin
const BASE_PLAYER_WIDTH = 63;
const BASE_PLAYER_DUCK_HEIGHT = 55;
const BASE_BIRD_HEIGHT = 40;
const BASE_BIRD_WIDTH = 40;
const BASE_STICK_HEIGHT = 20;
const BASE_STICK_WIDTH = 3;
const BASE_COIN_SPACING = 22; // Reduced by ~10%
const BASE_PLAYER_X = 10;

// Foot offset: visually shift player sprite down so feet touch platform
// (compensates for transparent padding at bottom of sprite)
const BASE_FOOT_OFFSET = 5;

// Token sizes
const BASE_TOKEN1_WIDTH = BASE_COIN_SIZE;
const BASE_TOKEN2_WIDTH = BASE_COIN_SPACING + BASE_COIN_SIZE;
const BASE_TOKEN3_WIDTH = BASE_COIN_SPACING * 2 + BASE_COIN_SIZE;
const BASE_TOKEN_HEIGHT = BASE_STICK_HEIGHT + BASE_COIN_SIZE;

const BASE_SPAWN_OFFSET = 150;

//=============================================================================
// PHYSICS
//=============================================================================
const SPEED_START = 4;
const SPEED_MAX = 4;
const SPEED_MAX_SCORE = 10000;
const BASE_GRAVITY = 0.8;
const BASE_JUMP_VELOCITY = -16;

//=============================================================================
// COMPUTED VALUES
//=============================================================================
let playerWidth = BASE_PLAYER_WIDTH;
let playerHeight = BASE_PLAYER_HEIGHT;
let playerDuckHeight = BASE_PLAYER_DUCK_HEIGHT;
let playerX = BASE_PLAYER_X;
let playerY = groundY - playerHeight;

let coinSize = BASE_COIN_SIZE;
let stickHeight = BASE_STICK_HEIGHT;
let stickWidth = BASE_STICK_WIDTH;
let coinSpacing = BASE_COIN_SPACING;

let token1Width = BASE_TOKEN1_WIDTH;
let token2Width = BASE_TOKEN2_WIDTH;
let token3Width = BASE_TOKEN3_WIDTH;
let tokenHeight = BASE_TOKEN_HEIGHT;
let tokenX = boardWidth + BASE_SPAWN_OFFSET;
let tokenY = groundY - tokenHeight;

let birdWidth = BASE_BIRD_WIDTH;
let birdHeight = BASE_BIRD_HEIGHT;
let birdX = boardWidth + BASE_SPAWN_OFFSET;
let birdY = groundY - playerHeight - birdHeight;

let hitboxPadding = 3;
let footOffset = BASE_FOOT_OFFSET; // Visual offset for feet alignment
let speed = SPEED_START;
let velocityX = -speed;
let velocityY = 0;
let gravity = BASE_GRAVITY;
let jumpVelocity = BASE_JUMP_VELOCITY;

let context;
let isMobileLayout = false;
let uiScale = 1;
let scorePadding = 10;
let scoreTop = 10;
let gameOverYRatio = 0.5;
let restartGap = 30;
let activeRightTouches = new Set();
let lastFrameTime = null;
let lastUpdateTime = 0; // For deltaTime calculation
let gameActive = true;
let showWelcome = false;
let _rafId = 0;
let isPaused = false;
const COIN_STORAGE_KEY = "baseapp_runner_coin_count";
const AUTH_TOKENS_STORAGE_KEY = "runner_auth_token";
const BASE_CHAIN_ID = "0x2105"; // 8453
const BASE_CHAIN_PARAMS = {
    chainId: BASE_CHAIN_ID,
    chainName: "Base",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"]
};
// Contract addresses (Base Mainnet)
const NFT_CONTRACT_ADDRESS = "0xF2cE35c71c356048C3e807430225287Bea788131";
const RUN_RECORDER_ADDRESS = "0x44D090F487fF730aCd94f6E3E9f832ff6b933d36";

// ERC-8021 Builder Code suffix for Base leaderboard attribution
// Code: bc_d5td9rtw
const BUILDER_CODE_SUFFIX = "0x62635f64357464397274770b0080218021802180218021802180218021";

// CDP Paymaster URL for gas-free transactions (EIP-5792 / Coinbase Smart Wallet)
// Get your API key at https://portal.cdp.coinbase.com/
const PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base/cjnueih0AaiYBVVOk5iiZRXjP00VX1fB';

// Normalize wallet_sendCalls response — EIP-5792 v1.0 returns string, v2.0 returns { id, capabilities }.
function extractCallsId(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && typeof raw.id === 'string') return raw.id;
    if (typeof raw === 'object' && typeof raw.batchId === 'string') return raw.batchId;
    return null;
}

function toHexValue(value) {
    if (value === undefined || value === null) return '0x0';
    return '0x' + BigInt(value).toString(16);
}

function getCapabilityStatus(value) {
    if (!value) return false;
    if (value === true) return true;
    if (typeof value === 'string') return value === 'ready' || value === 'supported';
    if (typeof value === 'object') {
        return getCapabilityStatus(value.status ?? value.supported);
    }
    return false;
}

const walletCapabilityCache = new Map();
async function getBaseWalletCapabilities(provider) {
    const cached = walletAddress ? walletCapabilityCache.get(walletAddress.toLowerCase()) : null;
    if (cached) return cached;

    const bridged = window.__walletBridge?.capabilities;
    if (bridged) {
        const normalized = {
            atomic: !!bridged.atomic,
            paymasterService: !!bridged.paymasterService,
        };
        if (walletAddress) walletCapabilityCache.set(walletAddress.toLowerCase(), normalized);
        return normalized;
    }

    try {
        const raw = await provider.request({ method: 'wallet_getCapabilities', params: [walletAddress] });
        const baseCaps = raw?.[BASE_CHAIN_ID] || raw?.[8453] || {};
        const normalized = {
            atomic: getCapabilityStatus(baseCaps.atomic),
            paymasterService: getCapabilityStatus(baseCaps.paymasterService),
        };
        if (walletAddress) walletCapabilityCache.set(walletAddress.toLowerCase(), normalized);
        return normalized;
    } catch (err) {
        return { atomic: false, paymasterService: false };
    }
}

// Poll wallet_getCallsStatus until we have a real transactionHash (receipts populated) or FAILED.
async function waitForCallsTxHash(provider, callsId) {
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        let status;
        try {
            status = await provider.request({ method: 'wallet_getCallsStatus', params: [callsId] });
        } catch (err) {
            console.warn('[pm] getCallsStatus error:', err.code, err.message);
            continue;
        }
        const s = status?.status;
        const txHash = status?.receipts?.[0]?.transactionHash;
        if ((s === 'CONFIRMED' || s === 200 || s === '200') && txHash) {
            return txHash;
        }
        if (s === 'FAILED' || s === 400 || s === 500 || s === '400' || s === '500') {
            throw new Error('Transaction failed');
        }
    }
    throw new Error('Transaction timeout');
}

async function waitForBridgeCallsTxHash(callsId) {
    const bridge = window.__walletBridge;
    if (bridge?.getCallsStatus) {
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const status = await bridge.getCallsStatus(callsId).catch(() => null);
            const s = status?.status;
            const txHash = status?.receipts?.[0]?.transactionHash;
            if ((s === 'CONFIRMED' || s === 200 || s === '200') && txHash) {
                return txHash;
            }
            if (s === 'FAILED' || s === 400 || s === 500 || s === '400' || s === '500') {
                throw new Error('Transaction failed');
            }
        }
        throw new Error('Transaction timeout');
    }

    const provider = bridge?.provider || getEthereumProvider();
    if (provider?.request) {
        return waitForCallsTxHash(provider, callsId);
    }
    return callsId;
}

async function waitForTransactionHash(txHash) {
    const provider = getEthereumProvider() || window.__walletBridge?.provider;
    if (!provider) return { hash: txHash };
    const ethersProvider = new ethers.BrowserProvider(provider);
    return await ethersProvider.waitForTransaction(txHash) || { hash: txHash };
}

// Send a contract call with Builder Code attribution and optional paymaster sponsorship.
// For Coinbase Smart Wallet (Base App), uses EIP-5792 wallet_sendCalls + paymaster so gas is free.
// Falls back to regular ethers sendTransaction for other wallets.
async function sendWithBuilderCode(signer, contract, method, args = []) {
    const populated = await contract[method].populateTransaction(...args);
    populated.data = populated.data + BUILDER_CODE_SUFFIX.slice(2);
    const bridge = window.__walletBridge;

    if (bridge?.sendCalls && PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY')) {
        try {
            const caps = await getBaseWalletCapabilities(bridge.provider);
            if (!caps.atomic || !caps.paymasterService) {
                throw Object.assign(new Error('wallet_sendCalls not supported by this wallet'), { code: -32601 });
            }
            const raw = await bridge.sendCalls({
                account: walletAddress,
                chainId: 8453,
                calls: [{
                    to: populated.to,
                    data: populated.data,
                    value: BigInt(populated.value || 0),
                }],
                capabilities: {
                    paymasterService: { url: PAYMASTER_URL }
                }
            });
            const callsId = extractCallsId(raw);
            if (!callsId) throw new Error('sendCalls returned no id');
            return {
                hash: callsId,
                wait: async () => ({ hash: await waitForBridgeCallsTxHash(callsId) })
            };
        } catch (err) {
            if (err.code === 4001 || err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('denied')) {
                throw err;
            }
            if (err.code !== -32601) {
                console.warn('[wagmi] sendCalls failed:', err.code, err.message, err.data || '');
            }
        }
    }

    // Try EIP-5792 wallet_sendCalls with paymaster (Coinbase Smart Wallet only)
    const _provider = getEthereumProvider();
    if (PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY') && _provider?.request) {
        try {
            const caps = await getBaseWalletCapabilities(_provider);
            if (!caps.atomic || !caps.paymasterService) {
                throw Object.assign(new Error('wallet_sendCalls not supported by this wallet'), { code: -32601 });
            }
            const raw = await _provider.request({
                method: 'wallet_sendCalls',
                params: [{
                    version: '1.0',
                    chainId: '0x2105',
                    from: walletAddress,
                    calls: [{
                        to: populated.to,
                        data: populated.data,
                        value: toHexValue(populated.value)
                    }],
                    capabilities: {
                        paymasterService: { url: PAYMASTER_URL }
                    }
                }]
            });
            const callsId = extractCallsId(raw);
            if (!callsId) throw new Error('wallet_sendCalls returned no id');
            return {
                hash: callsId,
                wait: async () => ({ hash: await waitForCallsTxHash(_provider, callsId) })
            };
        } catch (err) {
            // User rejected the paymaster-sponsored tx — don't silently fall back to gas-paying tx
            if (err.code === 4001 || err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('denied')) {
                throw err;
            }
            // Method not supported (-32601) → fallback is OK (wallet doesn't support wallet_sendCalls)
            if (err.code !== -32601) {
                console.warn('[pm] wallet_sendCalls failed:', err.code, err.message, err.data || '');
            }
        }
    }

    if (bridge?.sendTransaction) {
        const hash = await bridge.sendTransaction({
            to: populated.to,
            data: populated.data,
            value: populated.value,
        });
        return {
            hash,
            wait: async () => waitForTransactionHash(hash)
        };
    }

    return signer.sendTransaction(populated);
}

async function sendUpgradeWithGCSpend(signer, characterId, gcAmount) {
    const provider = getEthereumProvider();
    const gameCoin = new ethers.Contract(GAMECOIN_ADDRESS, GAMECOIN_ABI, signer);
    const upgradeContract = new ethers.Contract(CHARACTER_UPGRADE_ADDRESS, CHARACTER_UPGRADE_ABI, signer);
    const gcIface = new ethers.Interface(GAMECOIN_ABI);
    const upgradeIface = new ethers.Interface(CHARACTER_UPGRADE_ABI);
    const approveData = gcIface.encodeFunctionData('approve', [CHARACTER_UPGRADE_ADDRESS, gcAmount]);
    const upgradeData = upgradeIface.encodeFunctionData('upgrade', [characterId, gcAmount]) + BUILDER_CODE_SUFFIX.slice(2);
    const bridge = window.__walletBridge;

    if (PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY') && bridge?.sendCalls) {
        try {
            const caps = await getBaseWalletCapabilities(bridge.provider);
            if (!caps.atomic || !caps.paymasterService) {
                throw Object.assign(new Error('wallet_sendCalls not supported by this wallet'), { code: -32601 });
            }
            const raw = await bridge.sendCalls({
                account: walletAddress,
                chainId: 8453,
                calls: [
                    { to: GAMECOIN_ADDRESS, value: 0n, data: approveData },
                    { to: CHARACTER_UPGRADE_ADDRESS, value: 0n, data: upgradeData },
                ],
                capabilities: {
                    paymasterService: { url: PAYMASTER_URL }
                }
            });
            const callsId = extractCallsId(raw);
            if (!callsId) throw new Error('sendCalls returned no id');
            return {
                hash: callsId,
                wait: async () => ({ hash: await waitForBridgeCallsTxHash(callsId) })
            };
        } catch (err) {
            if (err.code === 4001 || err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('denied')) {
                throw err;
            }
            if (err.code !== -32601) {
                console.warn('[upgrade] wagmi batched upgrade failed:', err.code, err.message, err.data || '');
            }
        }
    }

    if (PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY') && provider?.request) {
        try {
            const caps = await getBaseWalletCapabilities(provider);
            if (!caps.atomic || !caps.paymasterService) {
                throw Object.assign(new Error('wallet_sendCalls not supported by this wallet'), { code: -32601 });
            }

            const raw = await provider.request({
                method: 'wallet_sendCalls',
                params: [{
                    version: '1.0',
                    chainId: BASE_CHAIN_ID,
                    from: walletAddress,
                    atomicRequired: true,
                    calls: [
                        { to: GAMECOIN_ADDRESS, value: '0x0', data: approveData },
                        { to: CHARACTER_UPGRADE_ADDRESS, value: '0x0', data: upgradeData },
                    ],
                    capabilities: {
                        paymasterService: { url: PAYMASTER_URL }
                    }
                }]
            });
            const callsId = extractCallsId(raw);
            if (!callsId) throw new Error('wallet_sendCalls returned no id');
            return {
                hash: callsId,
                wait: async () => ({ hash: await waitForCallsTxHash(provider, callsId) })
            };
        } catch (err) {
            if (err.code === 4001 || err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('denied')) {
                throw err;
            }
            if (err.code !== -32601) {
                console.warn('[upgrade] batched upgrade failed:', err.code, err.message, err.data || '');
            }
        }
    }

    const allowance = await gameCoin.allowance(walletAddress, CHARACTER_UPGRADE_ADDRESS);
    if (BigInt(allowance) < BigInt(gcAmount)) {
        const approveTx = await gameCoin.approve(CHARACTER_UPGRADE_ADDRESS, gcAmount);
        await approveTx.wait();
    }
    return sendWithBuilderCode(
        signer,
        upgradeContract,
        'upgrade',
        [characterId, gcAmount]
    );
}

const BACKEND_URL = "https://base-runner-k9oj.onrender.com";
const BACKEND_TIMEOUT_MS = 25000;
const ALLOW_GUEST_PLAY = false;

// Payments contract (RugPullRunPayments on Base mainnet)
const PAYMENTS_CONTRACT = "0x33e269ae12e0d1E4226A199fd6042d2fe9742855";
const PAYMENTS_ABI = [
    "function playPaidGame() payable",
    "function buyCoins(uint256 coinsAmount, uint256 usdcAmount)"
];

// Character upgrade contracts (set after deploy)
const GAMECOIN_ADDRESS          = "0xf111569425dA3CbCE407C16401aCb1663Dca054c";
const CHARACTER_UPGRADE_ADDRESS = "0x2A2528974D6A9B6Cf64eF53EF7248Da0D777b592";

const GAMECOIN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function mint(uint256 amount)",
    "function burn(uint256 amount)",
];
const CHARACTER_UPGRADE_ABI = [
    "function upgrade(uint256 characterId, uint256 gcAmount)",
    "function mintAndUpgrade(uint256 characterId, uint256 gcAmount)",
    "function getCharacterInfo(address player, uint256 characterId) view returns (uint256 lvl, uint256 xp, uint256 xpNext, uint256 xpPrev)",
    "function getCharacterLevels(address player, uint256[] characterIds) view returns (uint256[] levels, uint256[] xps)",
];

const GC_PER_COIN = 5;  // 1 in-game coin = 5 GC
const XP_LEVELS     = [0, 100, 400, 1100, 2600, 5600];
const LEVEL_LABELS  = ['Lv.0', 'Lv.1', 'Lv.2', 'Lv.3', 'Lv.4', 'Lv.5'];
const LEVEL_BONUS   = [
    { coins: 0, mult: 1.0 },
    { coins: 1, mult: 1.1 },
    { coins: 2, mult: 1.2 },
    { coins: 3, mult: 1.3 },
    { coins: 4, mult: 1.5 },
    { coins: 5, mult: 2.0 },
];
let characterLevelCache = {};  // { [charId]: { lvl, xp, xpNext, xpPrev } }

// USDC on Base mainnet
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_PER_COIN = 100_000n; // 0.1 USDC in 6-decimal units
const COIN_PACKAGE_USDC = new Map([[5000, 400_000_000n]]); // $400.00 for 5000 coins

// NFT Contract ABI
const NFT_ABI = [
    "function mintFreeCharacter() external",
    "function mintWithSignature(uint8 characterType, bytes32 nonce, uint256 expiry, bytes calldata signature) external",
    "function checkIn() external",
    "function canCheckIn(address wallet) external view returns (bool)",
    "function lastCheckin(address) external view returns (uint256)",
    "function canClaimFreeMint(address wallet) external view returns (bool)",
    "function hasClaimedFreeMint(address) external view returns (bool)",
    "function ownsCharacterType(address, uint8) external view returns (bool)",
    "function getOwnedCharacterList(address wallet) external view returns (uint8[])",
    "function balanceOf(address owner) external view returns (uint256)"
];

const RUN_RECORDER_ABI = [
    "function recordRun(uint256 score) external"
];

// Record completed run on-chain, then notify backend.
// Returns true if on-chain tx confirmed, false otherwise.
async function recordRunOnChain(finalScore) {
    if (!RUN_RECORDER_ADDRESS || !walletReady) return false;
    try {
        const p = getEthereumProvider();
        if (!p) return false;
        const ethersProvider = new ethers.BrowserProvider(p);
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(RUN_RECORDER_ADDRESS, RUN_RECORDER_ABI, signer);
        const tx = await sendWithBuilderCode(signer, contract, 'recordRun', [finalScore]);
        await tx.wait();
        return true;
    } catch (e) {
        console.error('recordRunOnChain failed:', e);
        return false;
    }
}

// UI State Machine
const UI_STATE = {
    CONNECT: 'connect',
    MENU: 'menu',
    RUNNING: 'running',
    PAUSED: 'paused',
    COLLECTION: 'collection'
};
let currentUIState = UI_STATE.CONNECT;

// Collection state
let hasFreeMint = false;       // User has minted free character (char 0)
let ownedCharacters = [];      // Array of owned character IDs
let collectionLoading = false;
let selectedCharacter = 0; // Currently selected character (0=Vitalik, 1=Trump)
let activeRunCharacterId = null; // Character locked for the current run
let activeRunLevel = 0; // Level locked for the current run
let collectionOpenedFrom = null; // Track where collection was opened from ('menu' or 'pause')

// Overlay elements
let overlayConnect;
let overlayMenu;
let overlayPause;
let overlayCollection;
let pauseButton;
let connectButton;
let connectStandardBtn;
let walletStatus;
let walletAddressDisplay;
let startButton;
let payGameButton;
let resumeButton;
let homeButtonPause;
let checkinButton;
let checkinStatus;
let checkinButtonPause;
let checkinStatusPause;
let testNotificationButton;
let testNotificationButtonPause;
let collectionButton;
let collectionButtonPause;
let collectionCloseBtn;
let mintVitalikBtn;
let mintTrumpBtn;
let collectionHint;
let ethImg;
// Game UI elements
let gameCoinsEl;
let gameScoreEl;
let gameBestEl;
let newRecordEl;
let gameUIContainer;
let gameOverOverlay;
let coinCount = 0;
let nextCoinScore = 1000;
// Coin popup animation state
let coinPopupActive = false;
let coinPopupStartTime = 0;
let coinPopupAmount = 0;
let coinPopupX = 0; // X position (set when coins UI is drawn)
let coinPopupY = 0; // Y position
const COIN_POPUP_DURATION = 3000; // 3 seconds fade out
let walletAddress = null;
let walletChainId = null;
let walletReady = false;
let isConnectingWallet = false;
let connectAttemptId = 0;
let isDetectingWallet = true; // Start true, set false after provider check
let walletErrorMessage = "";
let walletInfoMessage = "";
let walletAuthenticated = false;
let authInProgress = false;
let authAttempted = false;
let authToken = "";
let walletInitializing = false; // Prevent chainChanged from resetting auth during init
let walletBasename = null; // Resolved .base.eth name
let checkinState = {
    lastCheckin: null,
    streak: 0,
    canCheckin: true,
    loading: false,
    message: ""
};
let gameConfig = { treasuryAddress: null, paidGamePriceWei: "3000000000000" };
let isPaidGame = false;
let pendingPaidTxHash = null;
let backendSessionId = null;
let backendSessionPromise = null; // tracks in-flight session start
let backendSeed = null;
let backendInputLog = [];
let backendSessionStartMs = 0;
let backendSessionActive = false;
let backendRunSubmitted = false;
let runRecordedOnChain = false; // prevent duplicate recordRun calls per game
let rng = null;

function getViewportSize() {
    if (window.visualViewport) {
        return {
            width: window.visualViewport.width,
            height: window.visualViewport.height
        };
    }
    return {
        width: window.innerWidth,
        height: window.innerHeight
    };
}

function getSafeAreaLeftPx() {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--safe-left");
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

// Wallet state
let activeWalletType = null; // 'injected'

// App URL for deeplinks
const APP_URL = 'https://base-runner-k9oj.onrender.com';

// Check if running inside a wallet browser (Coinbase, MetaMask, Trust, etc.)
function isWalletBrowser() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('coinbase') || ua.includes('metamask') || ua.includes('trust') || ua.includes('rainbow')) {
        return true;
    }
    if (window.ethereum) {
        return window.ethereum.isCoinbaseWallet ||
               window.ethereum.isCoinbaseBrowser ||
               window.ethereum.isMetaMask ||
               window.ethereum.isTrust ||
               window.ethereum.isWalletBrowser;
    }
    return false;
}

// True only when running inside a mobile wallet app (not a desktop browser extension)
function isWalletApp() {
    return isWalletBrowser() && isMobile();
}

// Check if mobile device
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getEthereumProvider() {
    // Prefer wagmi bridge provider when React wallet is active
    if (window.__walletBridge?.provider) return window.__walletBridge.provider;
    // Return Web3Modal provider if connected via WalletConnect
    if (activeWalletType === 'walletconnect' && window.web3modalProvider) {
        return window.web3modalProvider;
    }
    // Return EIP-6963 selected provider or injected
    return window._activeProvider || window.ethereum || null;
}

// Initialize Web3Modal on demand
async function initWeb3Modal() {
    if (window.web3modal) return window.web3modal;
    if (window.web3modalLoading) {
        // Wait for loading to complete
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (window.web3modal) {
                    clearInterval(check);
                    resolve(window.web3modal);
                }
            }, 100);
            setTimeout(() => {
                clearInterval(check);
                resolve(null);
            }, 10000);
        });
    }
    
    window.web3modalLoading = true;
    
    try {
        const { createWeb3Modal, defaultConfig } = await import('https://esm.sh/@web3modal/ethers@5.1.11?bundle');
        
        // WalletConnect Cloud Project ID
        const projectId = '2b1bf48533e65943f2d6f749c353b1c9';
        
        const baseMainnet = {
            chainId: 8453,
            name: 'Base',
            currency: 'ETH',
            explorerUrl: 'https://basescan.org',
            rpcUrl: 'https://mainnet.base.org'
        };
        
        const metadata = {
            name: 'Rug Pull Run',
            description: 'Run and earn on Base',
            url: window.location.origin,
            icons: [window.location.origin + '/assets/eth.png']
        };
        
        const ethersConfig = defaultConfig({
            metadata,
            enableEIP6963: true,
            enableInjected: true,
            enableCoinbase: true,
            rpcUrl: 'https://mainnet.base.org'
        });

        const modal = createWeb3Modal({
            ethersConfig,
            chains: [baseMainnet],
            projectId,
            enableAnalytics: false,
            themeMode: 'dark'
        });
        
        window.web3modal = modal;
        window.web3modalLoading = false;
        // Setup provider listener - only react to actual connections/disconnections
        let wasConnectedViaModal = false;
        modal.subscribeProvider(async (state) => {
            if (state.isConnected && state.address) {
                const previousAddress = walletAddress;
                wasConnectedViaModal = true;
                walletAddress = state.address;
                walletChainId = state.chainId ? '0x' + state.chainId.toString(16) : null;
                activeWalletType = 'walletconnect';
                if (state.provider) {
                    window.web3modalProvider = state.provider;
                    // Set up listeners on the provider too
                    if (state.provider.on) {
                        state.provider.on("accountsChanged", handleAccountsChanged);
                        state.provider.on("chainChanged", handleChainChanged);
                    }
                }
                // Check if wallet changed (not first connect)
                if (previousAddress && previousAddress.toLowerCase() !== state.address.toLowerCase()) {
                    forceExitToMenu('Wallet changed');
                }
                // Close modal UI so it doesn't block the screen
                try { modal.close(); } catch (e) {}
                const restored = await restoreAuthSession();
                if (!restored) {
                    await authenticateWallet();
                }
                updateWalletUI();
            } else if (!state.isConnected && wasConnectedViaModal && activeWalletType === 'walletconnect') {
                // Only disconnect if user was actually connected via this modal
                wasConnectedViaModal = false;
                walletAddress = null;
                activeWalletType = null;
                window.web3modalProvider = null;
                resetAuthState();
                forceExitToMenu('Wallet disconnected');
                updateWalletUI();
            }
        });
        
        return modal;
    } catch (err) {
        console.error('Failed to load Web3Modal:', err);
        window.web3modalLoading = false;
        return null;
    }
}
// Wait for ethereum provider to be injected (some wallets inject asynchronously)
function waitForEthereumProvider(maxWaitMs = 3000) {
    return new Promise((resolve) => {
        if (window.ethereum) {
            resolve(window.ethereum);
            return;
        }
        
        let resolved = false;
        
        // Listen for provider injection event
        const handleEthereum = () => {
            if (!resolved && window.ethereum) {
                resolved = true;
                window.removeEventListener("ethereum#initialized", handleEthereum);
                resolve(window.ethereum);
            }
        };
        
        window.addEventListener("ethereum#initialized", handleEthereum);
        
        // Also poll in case the event doesn't fire
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.ethereum) {
                resolved = true;
                clearInterval(checkInterval);
                window.removeEventListener("ethereum#initialized", handleEthereum);
                resolve(window.ethereum);
            } else if (Date.now() - startTime > maxWaitMs) {
                clearInterval(checkInterval);
                window.removeEventListener("ethereum#initialized", handleEthereum);
                resolve(null);
            }
        }, 100);
    });
}

// Discover installed wallets via EIP-6963
function discoverEIP6963Providers() {
    return new Promise((resolve) => {
        const providers = [];
        const handler = (event) => {
            providers.push(event.detail);
        };
        window.addEventListener('eip6963:announceProvider', handler);
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        // Wallets respond synchronously or within a tick
        setTimeout(() => {
            window.removeEventListener('eip6963:announceProvider', handler);
            resolve(providers);
        }, 200);
    });
}

// Show wallet type selection first (Smart Wallet vs Standard), then wallet picker
async function showWalletSelector() {
    const existingModal = document.getElementById('wallet-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'wallet-modal';
    modal.innerHTML = `
        <div class="wallet-modal-backdrop"></div>
        <div class="wallet-modal-content">
            <h3>Connect Wallet</h3>
            <div class="wallet-options">
                <button type="button" class="wallet-option" id="btn-smart-wallet">
                    <img src="https://avatars.githubusercontent.com/u/18060234?s=200&v=4" alt="Coinbase" width="32" height="32">
                    <span>Smart Wallet</span>
                </button>
                <button type="button" class="wallet-option" id="btn-standard-wallet">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="Standard" width="32" height="32">
                    <span>Standard Wallet</span>
                </button>
            </div>
            <button type="button" class="wallet-modal-close">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);

    if (!document.getElementById('wallet-modal-styles')) {
        const styles = document.createElement('style');
        styles.id = 'wallet-modal-styles';
        styles.textContent = `
            #wallet-modal { position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;display:flex;align-items:center;justify-content:center; }
            .wallet-modal-backdrop { position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:1; }
            .wallet-modal-content { position:relative;z-index:2;background:linear-gradient(180deg,#1a1a2e 0%,#16213e 100%);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;min-width:320px;max-width:90%;box-shadow:0 20px 40px rgba(0,0,0,0.4); }
            .wallet-modal-content h3 { color:white;margin:0 0 20px 0;text-align:center;font-size:18px; }
            .wallet-options { display:flex;flex-direction:column;gap:12px; }
            .wallet-option { display:flex;align-items:center;gap:12px;padding:16px 18px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:12px;color:white;cursor:pointer;font-size:16px;width:100%;text-align:left;touch-action:manipulation; }
            .wallet-option:hover,.wallet-option:active { background:rgba(255,255,255,0.15);border-color:#0052ff; }
            .wallet-option img { border-radius:8px;width:32px;height:32px; }
            .wallet-badge { margin-left:auto;font-size:11px;padding:3px 8px;background:#0052ff;border-radius:4px;color:white; }
            .wallet-badge-secondary { margin-left:auto;font-size:11px;padding:3px 8px;background:rgba(255,255,255,0.2);border-radius:4px;color:white; }
            .wallet-modal-close { width:100%;margin-top:16px;padding:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:15px;touch-action:manipulation; }
            .wallet-modal-close:hover,.wallet-modal-close:active { background:rgba(255,255,255,0.1); }
        `;
        document.head.appendChild(styles);
    }

    const closeModal = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } modal.remove(); };
    modal.querySelector('.wallet-modal-backdrop').addEventListener('click', closeModal);
    modal.querySelector('.wallet-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.wallet-modal-close').addEventListener('touchend', closeModal);

    // Smart Wallet button
    const smartBtn = modal.querySelector('#btn-smart-wallet');
    const handleSmart = (e) => { e.preventDefault(); e.stopPropagation(); modal.remove(); connectWithCoinbaseSmartWallet(); };
    smartBtn.addEventListener('click', handleSmart);
    smartBtn.addEventListener('touchend', handleSmart);

    // Standard Wallet button — show full wallet picker
    const standardBtn = modal.querySelector('#btn-standard-wallet');
    const handleStandard = (e) => { e.preventDefault(); e.stopPropagation(); modal.remove(); showStandardWalletPicker(); };
    standardBtn.addEventListener('click', handleStandard);
    standardBtn.addEventListener('touchend', handleStandard);
}

// Full wallet picker (MetaMask, WalletConnect, etc.)
async function showStandardWalletPicker() {
    const existingModal = document.getElementById('wallet-modal');
    if (existingModal) existingModal.remove();

    const mobile = isMobile();
    const modal = document.createElement('div');
    modal.id = 'wallet-modal';

    let buttonsHtml = '';

    if (!mobile) {
        // Desktop — discover installed wallets via EIP-6963
        const eip6963Wallets = await discoverEIP6963Providers();
        window._lastEIP6963Wallets = eip6963Wallets;

        if (eip6963Wallets.length > 0) {
            // Render a button for each discovered wallet
            eip6963Wallets.forEach((w, i) => {
                const icon = w.info.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
                buttonsHtml += `
                    <button type="button" class="wallet-option" data-eip6963-idx="${i}">
                        <img src="${icon}" alt="${w.info.name}" width="32" height="32">
                        <span>${w.info.name}</span>
                    </button>`;
            });
        } else if (window.ethereum) {
            // Fallback — single injected provider, no EIP-6963
            buttonsHtml = `
                <button type="button" class="wallet-option" id="btn-injected-fallback">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="Wallet" width="32" height="32">
                    <span>Browser Wallet</span>
                </button>`;
        }

        // Coinbase Wallet (Smart Wallet — no extension needed)
        const hasCoinbaseEIP6963 = eip6963Wallets.some(w => w.info.rdns === 'com.coinbase.wallet');
        if (!hasCoinbaseEIP6963) {
            buttonsHtml += `
                <button type="button" class="wallet-option" id="btn-coinbase-desktop">
                    <img src="https://avatars.githubusercontent.com/u/18060234?s=200&v=4" alt="Coinbase Wallet" width="32" height="32">
                    <span>Coinbase Wallet</span>
                    <span class="wallet-badge">Smart Wallet</span>
                </button>`;
        }

        // Always offer WalletConnect as last option
        buttonsHtml += `
            <button type="button" class="wallet-option" id="btn-walletconnect">
                <img src="https://avatars.githubusercontent.com/u/37784886?s=200&v=4" alt="WalletConnect" width="32" height="32">
                <span>WalletConnect</span>
            </button>`;
    } else {
        // Mobile browser
        buttonsHtml = `
            <button type="button" class="wallet-option" id="btn-coinbase">
                <img src="https://avatars.githubusercontent.com/u/18060234?s=200&v=4" alt="Coinbase" width="32" height="32">
                <span>Coinbase Wallet</span>
            </button>
            <button type="button" class="wallet-option" id="btn-walletconnect">
                <img src="https://avatars.githubusercontent.com/u/37784886?s=200&v=4" alt="WalletConnect" width="32" height="32">
                <span>Other Wallets</span>
            </button>`;
    }

    modal.innerHTML = `
        <div class="wallet-modal-backdrop"></div>
        <div class="wallet-modal-content">
            <h3>Connect Wallet</h3>
            <div class="wallet-options">${buttonsHtml}</div>
            <button type="button" class="wallet-modal-close">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Add styles if not already added
    if (!document.getElementById('wallet-modal-styles')) {
        const styles = document.createElement('style');
        styles.id = 'wallet-modal-styles';
        styles.textContent = `
            #wallet-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .wallet-modal-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 1;
            }
            .wallet-modal-content {
                position: relative;
                z-index: 2;
                background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 24px;
                min-width: 320px;
                max-width: 90%;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                pointer-events: auto;
            }
            .wallet-modal-content h3 {
                color: white;
                margin: 0 0 8px 0;
                text-align: center;
                font-size: 18px;
            }
            .wallet-modal-subtitle {
                color: rgba(255,255,255,0.6);
                margin: 0 0 20px 0;
                text-align: center;
                font-size: 14px;
            }
            .wallet-options {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .wallet-option {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 18px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                color: white;
                cursor: pointer;
                transition: all 0.15s;
                font-size: 16px;
                text-decoration: none;
                width: 100%;
                text-align: left;
                -webkit-tap-highlight-color: rgba(0,82,255,0.3);
                touch-action: manipulation;
                pointer-events: auto;
                user-select: none;
                -webkit-user-select: none;
            }
            .wallet-option:hover,
            .wallet-option:focus,
            .wallet-option:active {
                background: rgba(255, 255, 255, 0.15);
                border-color: #0052ff;
                outline: none;
            }
            .wallet-option img {
                border-radius: 8px;
                width: 32px;
                height: 32px;
            }
            .wallet-badge {
                margin-left: auto;
                font-size: 11px;
                padding: 3px 8px;
                background: #0052ff;
                border-radius: 4px;
                color: white;
            }
            .wallet-badge-secondary {
                margin-left: auto;
                font-size: 11px;
                padding: 3px 8px;
                background: rgba(255,255,255,0.2);
                border-radius: 4px;
                color: white;
            }
            .wallet-modal-close {
                width: 100%;
                margin-top: 16px;
                padding: 14px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                color: rgba(255, 255, 255, 0.7);
                cursor: pointer;
                font-size: 15px;
                pointer-events: auto;
                touch-action: manipulation;
                -webkit-tap-highlight-color: rgba(255,255,255,0.1);
            }
            .wallet-modal-close:hover,
            .wallet-modal-close:active {
                background: rgba(255, 255, 255, 0.1);
            }
        `;
        document.head.appendChild(styles);
    }
    
    // Handle close
    const backdrop = modal.querySelector('.wallet-modal-backdrop');
    const closeBtn = modal.querySelector('.wallet-modal-close');
    
    const closeModal = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        modal.remove();
    };
    
    backdrop.addEventListener('click', closeModal);
    backdrop.addEventListener('touchend', closeModal);
    closeBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('touchend', closeModal);
    
    // --- Button handlers ---

    // EIP-6963 wallet buttons (desktop)
    if (!mobile) {
        const eip6963Wallets = window._lastEIP6963Wallets || [];
        modal.querySelectorAll('[data-eip6963-idx]').forEach(btn => {
            const idx = parseInt(btn.getAttribute('data-eip6963-idx'));
            const handler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                modal.remove();
                connectWithInjected(eip6963Wallets[idx]?.provider);
            };
            btn.addEventListener('click', handler);
            btn.addEventListener('touchend', handler);
        });

        // Fallback injected
        const fallbackBtn = modal.querySelector('#btn-injected-fallback');
        if (fallbackBtn) {
            const handler = (e) => { e.preventDefault(); e.stopPropagation(); modal.remove(); connectWithInjected(); };
            fallbackBtn.addEventListener('click', handler);
            fallbackBtn.addEventListener('touchend', handler);
        }
    }

    // WalletConnect button (desktop & mobile)
    const wcBtn = modal.querySelector('#btn-walletconnect');
    if (wcBtn) {
        const handleWC = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            wcBtn.innerHTML = '<span>Loading...</span>';
            wcBtn.disabled = true;
            try {
                const web3modal = await initWeb3Modal();
                modal.remove();
                if (web3modal) { await web3modal.open(); return; }
            } catch (err) {
                console.error('Web3Modal error:', err);
            }
            modal.remove();
        };
        wcBtn.addEventListener('click', handleWC);
        wcBtn.addEventListener('touchend', handleWC);
    }

    // Coinbase Smart Wallet (desktop, no extension)
    const coinbaseDesktopBtn = modal.querySelector('#btn-coinbase-desktop');
    if (coinbaseDesktopBtn) {
        const handleCBDesktop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.remove();
            await connectWithCoinbaseSmartWallet();
        };
        coinbaseDesktopBtn.addEventListener('click', handleCBDesktop);
        coinbaseDesktopBtn.addEventListener('touchend', handleCBDesktop);
    }

    // Coinbase deeplink (mobile only)
    const coinbaseBtn = modal.querySelector('#btn-coinbase');
    if (coinbaseBtn) {
        const handleCB = (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.remove();
            const link = `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(APP_URL)}`;
            window.location.href = link;
        };
        coinbaseBtn.addEventListener('click', handleCB);
        coinbaseBtn.addEventListener('touchend', handleCB);
    }
}

// Connect with injected wallet (MetaMask, etc.)
// Accepts optional EIP-6963 provider; falls back to window.ethereum
// Connect via Coinbase Smart Wallet SDK (no extension required)
async function connectWithCoinbaseSmartWallet() {
    try {
        const { CoinbaseWalletSDK } = await import('https://esm.sh/@coinbase/wallet-sdk@4?bundle');
        const sdk = new CoinbaseWalletSDK({
            appName: 'Rug Pull Run',
            appLogoUrl: 'https://rugpullrun.app/assets/coin.png',
        });
        const cbProvider = sdk.makeWeb3Provider({ options: 'smartWalletOnly' });
        await connectWithInjected(cbProvider);
    } catch (err) {
        console.error('Coinbase Smart Wallet error:', err);
        isConnectingWallet = false;
        setWalletError('Failed to connect Coinbase Wallet');
        updateWalletUI();
    }
}

async function connectWithInjected(eip6963Provider) {
    const provider = eip6963Provider || window.ethereum;
    if (!provider) {
        setWalletError("No browser wallet found");
        return;
    }

    const myAttempt = ++connectAttemptId;
    try {
        activeWalletType = 'injected';
        isConnectingWallet = true;
        updateWalletUI();

        const accounts = await provider.request({ method: "eth_requestAccounts" });
        if (myAttempt !== connectAttemptId) return; // user clicked connect again, ignore this stale response
        walletAddress = accounts[0] || null;

        // Get chain id
        const chainId = await provider.request({ method: "eth_chainId" });
        walletChainId = normalizeChainId(chainId) || chainId;

        // Switch to Base if needed
        if (walletChainId !== BASE_CHAIN_ID) {
            try {
                await provider.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: BASE_CHAIN_ID }]
                });
                walletChainId = BASE_CHAIN_ID;
            } catch (e) {
                console.warn("Chain switch failed:", e);
            }
        }

        // If a custom provider was passed (EIP-6963), override window.ethereum for this session
        if (eip6963Provider) {
            window._activeProvider = eip6963Provider;
        }

        // Set up event listeners on the provider
        if (provider.on) {
            provider.on("accountsChanged", handleAccountsChanged);
            provider.on("chainChanged", handleChainChanged);
        }

        // Authenticate with backend
        resetAuthState();
        const restored = await restoreAuthSession();
        if (!restored && walletAddress) {
            await authenticateWallet();
        }
        resolveBasename(walletAddress);

        isConnectingWallet = false;
        updateWalletUI();
    } catch (err) {
        if (myAttempt !== connectAttemptId) return; // stale — a newer attempt is already running
        console.error("Injected wallet connect error:", err);
        if (err.code === 4001 || (err.message && err.message.toLowerCase().includes('reject'))) {
            setWalletError("Cancelled in wallet.");
        } else {
            setWalletError(err.message || "Connection failed");
        }
        isConnectingWallet = false;
        activeWalletType = null;
        updateWalletUI();
    }
}

function formatAddress(address) {
    if (!address) return "";
    // Show basename if resolved
    if (walletBasename) return walletBasename;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Resolve .base.eth basename via raw JSON-RPC (no ethers dependency)
async function resolveBasename(address) {
    if (!address) return;
    // Show cached basename immediately while resolving fresh
    const cacheKey = 'basename_' + address.toLowerCase();
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        walletBasename = cached;
        const addrEl = document.getElementById('wallet-address');
        if (addrEl) addrEl.textContent = cached;
        const pauseEl = document.getElementById('wallet-address-pause');
        if (pauseEl) pauseEl.textContent = cached;
    } else {
        walletBasename = null;
    }
    try {
        const BASE_RPC = 'https://mainnet.base.org';
        const paddedAddr = address.toLowerCase().slice(2).padStart(64, '0');

        // Step 1: Call ReverseRegistrar.node(address) -> bytes32
        const nodeResult = await fetch(BASE_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'eth_call',
                params: [{ to: '0x79EA96012eEa67A83431F1701B3dFf7e37F9E282', data: '0xbffbe61c' + paddedAddr }, 'latest']
            })
        });
        const nodeJson = await nodeResult.json();
        const reverseNode = nodeJson.result;
        if (!reverseNode || reverseNode === '0x' || reverseNode.length < 66) return;

        // Step 2: Call L2Resolver.name(bytes32) -> string
        const nameResult = await fetch(BASE_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 2, method: 'eth_call',
                params: [{ to: '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD', data: '0x691f3431' + reverseNode.slice(2) }, 'latest']
            })
        });
        const nameJson = await nameResult.json();
        if (!nameJson.result || nameJson.result === '0x' || nameJson.result.length <= 130) return;

        // Decode ABI-encoded string
        const hex = nameJson.result.slice(2);
        const strOffset = parseInt(hex.slice(0, 64), 16) * 2;
        const strLen = parseInt(hex.slice(strOffset, strOffset + 64), 16);
        if (strLen > 0 && strLen < 256) {
            const strHex = hex.slice(strOffset + 64, strOffset + 64 + strLen * 2);
            const name = new TextDecoder().decode(new Uint8Array(strHex.match(/.{2}/g).map(b => parseInt(b, 16))));
            if (name && name.includes('.')) {
                walletBasename = name;
                localStorage.setItem(cacheKey, name);
                // Directly update address display elements (updateWalletUI skips updateUIState if already in MENU)
                const formatted = name;
                const addrEl = document.getElementById('wallet-address');
                if (addrEl) addrEl.textContent = formatted;
                const pauseEl = document.getElementById('wallet-address-pause');
                if (pauseEl) pauseEl.textContent = formatted;
            }
        }
    } catch (err) {
        // Silently fail — display truncated address
    }
}

function isValidAddress(address) {
    return typeof address === "string"
        && address.startsWith("0x")
        && address.length === 42
        && address !== "0x0000000000000000000000000000000000000000";
}

function normalizeChainId(chainId) {
    if (typeof chainId === "number" && Number.isFinite(chainId)) {
        return `0x${chainId.toString(16)}`.toLowerCase();
    }
    if (typeof chainId === "string") {
        if (chainId.startsWith("0x")) {
            return chainId.toLowerCase();
        }
        const parsed = parseInt(chainId, 10);
        if (Number.isFinite(parsed)) {
            return `0x${parsed.toString(16)}`.toLowerCase();
        }
    }
    return null;
}

function hashSeedToInt(seed) {
    let h = 2166136261;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(a) {
    return function rng() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createRng(seed) {
    const intSeed = hashSeedToInt(seed);
    return mulberry32(intSeed);
}

function getRandom() {
    return rng ? rng() : Math.random();
}

function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isToday(dateKeyOrTimestamp) {
    if (!dateKeyOrTimestamp) return false;
    if (typeof dateKeyOrTimestamp === 'number') {
        return getDateKey(new Date(dateKeyOrTimestamp)) === getDateKey();
    }
    return dateKeyOrTimestamp === getDateKey();
}

function getWalletDisplayName() {
    const stored = localStorage.getItem("runner_base_nickname");
    if (stored && stored.trim()) {
        return stored.trim();
    }
    return walletAddress || "";
}

function getAuthTokensMap() {
    const raw = localStorage.getItem(AUTH_TOKENS_STORAGE_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
    } catch (err) {
        // legacy token stored as plain string
    }
    return {};
}

function getAuthTokenForAddress(address) {
    if (!address) return "";
    const raw = localStorage.getItem(AUTH_TOKENS_STORAGE_KEY);
    if (!raw) return "";
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            const token = parsed[address.toLowerCase()];
            return typeof token === "string" ? token : "";
        }
    } catch (err) {
        if (raw && raw.includes(".")) {
            const map = { [address.toLowerCase()]: raw };
            localStorage.setItem(AUTH_TOKENS_STORAGE_KEY, JSON.stringify(map));
            return raw;
        }
    }
    return "";
}

function storeAuthSession(token, address) {
    if (!token || !address) return;
    const map = getAuthTokensMap();
    map[address.toLowerCase()] = token;
    localStorage.setItem(AUTH_TOKENS_STORAGE_KEY, JSON.stringify(map));
}

function clearAuthTokenForAddress(address) {
    if (!address) return;
    const map = getAuthTokensMap();
    delete map[address.toLowerCase()];
    const keys = Object.keys(map);
    if (keys.length === 0) {
        localStorage.removeItem(AUTH_TOKENS_STORAGE_KEY);
    } else {
        localStorage.setItem(AUTH_TOKENS_STORAGE_KEY, JSON.stringify(map));
    }
}

function resetAuthState() {
    walletAuthenticated = false;
    authToken = "";
    authAttempted = false;
    walletBasename = null;
    isPaidGame = false;
    pendingPaidTxHash = null;
}

function shouldRestoreAuth() {
    if (!walletAddress) return false;
    const token = getAuthTokenForAddress(walletAddress);
    return !!token;
}

async function restoreAuthSession() {
    if (!BACKEND_URL) return false;
    if (!shouldRestoreAuth()) return false;
    authToken = getAuthTokenForAddress(walletAddress);
    try {
        const response = await fetch(`${BACKEND_URL}/api/user/me`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) {
            throw new Error(`Session invalid: ${response.status}`);
        }
        const data = await response.json();
        if (!data || !data.ok) {
            throw new Error("Session rejected");
        }
        walletAuthenticated = true;
        await applyProfileData(data);
        resolveBasename(walletAddress);
        return true;
    } catch (err) {
        resetAuthState();
        clearAuthTokenForAddress(walletAddress);
        return false;
    }
}

function buildAuthMessage({ address, nonce, chainId, issuedAt }) {
    return [
        "Rug Pull Run",
        `Address: ${address}`,
        `Nonce: ${nonce}`,
        `ChainId: ${chainId}`,
        `IssuedAt: ${issuedAt}`
    ].join("\n");
}

async function signWalletMessage(message) {
    const provider = getEthereumProvider();
    if (!provider || !walletAddress) {
        throw new Error("Wallet not connected");
    }
    // Convert message to hex for better wallet compatibility
    const hexMessage = "0x" + Array.from(new TextEncoder().encode(message))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    return await provider.request({
        method: "personal_sign",
        params: [hexMessage, walletAddress]
    });
}

async function authenticateWallet() {
    if (!walletAddress || authInProgress || walletAuthenticated) {
        return;
    }
    authInProgress = true;
    authAttempted = true;
    clearWalletMessages();
    setWalletInfo("Confirm authorization in wallet.");
    updateWalletUI();
    try {
        const chainId = normalizeChainId(walletChainId) || walletChainId;
        if (!chainId) {
            throw new Error("ChainId missing");
        }
        const nonceResponse = await fetch(`${BACKEND_URL}/auth/nonce`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                address: walletAddress,
                chainId
            })
        });
        if (!nonceResponse.ok) {
            throw new Error(`Nonce failed: ${nonceResponse.status}`);
        }
        const nonceData = await nonceResponse.json();
        const message = buildAuthMessage({
            address: walletAddress,
            nonce: nonceData.nonce,
            chainId,
            issuedAt: nonceData.issuedAt
        });
        const signature = await signWalletMessage(message);
        const response = await fetch(`${BACKEND_URL}/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                address: walletAddress,
                signature
            })
        });
        if (!response.ok) {
            throw new Error(`Auth failed: ${response.status}`);
        }
        const data = await response.json();
        if (!data || !data.ok) {
            throw new Error("Auth rejected: " + (data?.error || 'unknown'));
        }
        authToken = data.token || "";
        walletAuthenticated = true;
        storeAuthSession(authToken, walletAddress);
        await applyProfileData(data);
        resolveBasename(walletAddress);
    } catch (err) {
        console.warn("Auth failed:", err.message, err);
        walletAuthenticated = false;
        authToken = "";
        clearAuthTokenForAddress(walletAddress);
        setWalletError("Authorization failed. Please try again.");
    } finally {
        authInProgress = false;
        updateWalletUI();
    }
}

// ============ Check-in (on-chain TX + backend streak) ============

async function getCheckinStats() {
    if (!authToken) return null;
    try {
        const res = await fetch(`${BACKEND_URL}/api/checkin/status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (!data.ok) return null;
        return {
            lastCheckin: data.lastCheckin,
            streak: data.streak,
            canCheckin: data.canCheckin,
            nextReward: data.nextReward
        };
    } catch (err) {
        console.warn("Failed to get checkin stats:", err);
        return null;
    }
}

async function sendCheckinTransaction() {
    if (!authToken) throw new Error("Not authenticated");
    if (!walletReady) throw new Error("Wallet not connected");

    // 1. Send on-chain TX
    const provider = getEthereumProvider();
    const ethersProvider = new ethers.BrowserProvider(provider);
    const signer = await ethersProvider.getSigner();
    const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);

    const tx = await sendWithBuilderCode(signer, contract, 'checkIn');
    const receipt = await tx.wait();

    // 2. Notify backend with txHash
    const res = await fetch(`${BACKEND_URL}/api/checkin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: receipt.hash })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Check-in failed');
    return data;
}

function resetBackendSession() {
    backendSessionId = null;
    backendSeed = null;
    backendInputLog = [];
    backendSessionStartMs = 0;
    backendSessionActive = false;
    backendRunSubmitted = false;
    runRecordedOnChain = false;
    rng = null;
    backendSessionPromise = null;
}

function resetFullSession() {
    resetBackendSession();
    isPaidGame = false;
    pendingPaidTxHash = null;
    activeRunCharacterId = null;
    activeRunLevel = 0;
}

function recordInput(type) {
    if (!backendSessionActive || gameState === GAME_STATE.GAME_OVER || showWelcome || isPaused) {
        return;
    }
    const elapsed = Math.round(performance.now() - backendSessionStartMs);
    backendInputLog.push({ t: elapsed, type });
}

async function fetchGameConfig() {
    if (!BACKEND_URL) return;
    // Retry with backoff — first call doubles as a cold-start warmup for Render's free tier.
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/game-config`);
            if (res.ok) {
                const data = await res.json();
                gameConfig.treasuryAddress = data.treasuryAddress || null;
                gameConfig.paidGamePriceWei = data.paidGamePriceWei || "3000000000000";
                return;
            }
        } catch (e) {
            if (attempt === 3) console.warn("Failed to fetch game config:", e);
        }
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
}

async function startPaidBackendSession(txHash) {
    const savedStartMs = backendSessionStartMs; // set by restartGame() before this call
    resetBackendSession();
    backendSessionStartMs = savedStartMs;
    isPaidGame = true; // restore after reset — must stay true during the game
    if (!BACKEND_URL || !authToken) { return false; }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    backendSessionPromise = (async () => {
    try {
        const response = await fetch(`${BACKEND_URL}/api/session/start-paid`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ txHash, characterId: activeRunCharacterId ?? selectedCharacter ?? 0 }),
            signal: controller.signal
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Backend start-paid failed: ${response.status}`);
        }
        const data = await response.json();
        backendSessionId = data.sessionId || null;
        backendSeed = data.seed || null;
        if (Number.isFinite(data.characterId) && data.characterId === activeRunCharacterId) {
            activeRunLevel = clampCharacterLevel(data.characterLevel);
        }
        // backendSessionStartMs already set in restartGame() — don't overwrite
        backendInputLog = [];
        backendSessionActive = !!backendSessionId;
        rng = backendSeed ? createRng(backendSeed) : null;
        return backendSessionActive;
    } catch (err) {
        console.warn('[paid-session] failed:', err.message);
        backendSessionActive = false;
        // don't call resetBackendSession — preserves backendSessionPromise so submitBackendRun can detect completion
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
    })();
    return backendSessionPromise;
}

async function startBackendSession() {
    const savedStartMs = backendSessionStartMs; // set by restartGame() before this call
    resetBackendSession();
    backendSessionStartMs = savedStartMs;
    if (!BACKEND_URL || !authToken) {
        return false;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    backendSessionPromise = (async () => {
    try {
        const response = await fetch(`${BACKEND_URL}/api/session/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ characterId: activeRunCharacterId ?? selectedCharacter ?? 0 }),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Backend start failed: ${response.status}`);
        }
        const data = await response.json();
        backendSessionId = data.sessionId || null;
        backendSeed = data.seed || null;
        if (Number.isFinite(data.characterId) && data.characterId === activeRunCharacterId) {
            activeRunLevel = clampCharacterLevel(data.characterLevel);
        }
        // backendSessionStartMs already set in restartGame() — don't overwrite
        backendInputLog = [];
        backendSessionActive = !!backendSessionId;
        rng = backendSeed ? createRng(backendSeed) : null;
        return backendSessionActive;
    } catch (err) {
        console.warn("Backend session start failed", err.message);
        backendSessionActive = false;
        // don't call resetBackendSession — preserves backendSessionPromise so submitBackendRun can detect completion
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
    })();
    return backendSessionPromise;
}

async function submitBackendRun(finalScore) {
    if (backendRunSubmitted || !BACKEND_URL) return;
    backendRunSubmitted = true; // set immediately to prevent double-submit
    // If session is still starting (slow mobile / Render cold start / paid-tx indexing),
    // wait up to BACKEND_TIMEOUT_MS for it — otherwise coins awarded this run are lost.
    if (!backendSessionActive && backendSessionPromise) {
        await Promise.race([
            backendSessionPromise,
            new Promise(r => setTimeout(r, BACKEND_TIMEOUT_MS))
        ]);
    }
    if (!backendSessionActive) {
        return;
    }
    const gameElapsedMs = Math.round(performance.now() - backendSessionStartMs);
    const payload = {
        sessionId: backendSessionId,
        reportedScore: finalScore,
        inputLog: backendInputLog,
        gameElapsedMs: gameElapsedMs
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    try {
        const response = await fetch(`${BACKEND_URL}/api/session/submit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(`submit ${response.status}: ${errBody.error || ''}`);
        }
        const data = await response.json();
        if (data && data.ok) {
            if (Number.isFinite(data.coinBalance)) {
                coinCount = data.coinBalance;
                saveCoins();
            }
            if (Number.isFinite(data.bestScore)) {
                bestScore = data.bestScore;
                localStorage.setItem("baseapp_runner_best_score", String(bestScore));
            }
        }
    } catch (err) {
        console.warn('submit failed:', err.message);
    } finally {
        clearTimeout(timeoutId);
    }
}

function handleGameOver() {
    if (runRecordedOnChain) return;
    runRecordedOnChain = true;
    // submitBackendRun waits internally for session if still in-flight
    submitBackendRun(rawScore);
    // Record on-chain in parallel (fire-and-forget)
    recordRunOnChain(score);
    // Paid game is one-shot — consume the flag so any restart becomes a free game
    isPaidGame = false;
    pendingPaidTxHash = null;
}

function setGameOverState() {
    if (gameState === GAME_STATE.GAME_OVER) {
        return;
    }
    gameState = GAME_STATE.GAME_OVER;
    gameOverTimestamp = performance.now();
    gameOver = true;
    // Show full-screen game over overlay
    if (gameOverOverlay) {
        // Update restart text based on device
        const restartTextEl = gameOverOverlay.querySelector('.game-over-restart');
        if (restartTextEl) {
            restartTextEl.textContent = isMobileLayout ? "TAP to restart" : "Press SPACE to restart";
        }
        gameOverOverlay.classList.remove('hidden');
    }
}

function setWalletStatus(message, isError) {
    if (!walletStatus) return;
    walletStatus.textContent = message;
    walletStatus.style.color = isError ? "#a00000" : "#333";
}

function setWalletError(message) {
    walletErrorMessage = message || "";
}

function setWalletInfo(message) {
    walletInfoMessage = message || "";
}

function clearWalletMessages() {
    walletErrorMessage = "";
    walletInfoMessage = "";
}

function setConnectButtonText(text) {
    if (!connectButton) return;
    connectButton.textContent = text;
}

function updateWalletUI() {
    const isConnected = !!walletAddress;
    const normalizedChainId = normalizeChainId(walletChainId);
    const isOnBase = normalizedChainId === BASE_CHAIN_ID;
    const walletConnected = isConnected && isOnBase;
    walletReady = walletConnected && walletAuthenticated;
    const canPlayNow = walletReady || ALLOW_GUEST_PLAY;

    // Update connect button state and text - always enabled (we have universal options)
    if (connectButton) {
        connectButton.disabled = isDetectingWallet || isConnectingWallet || authInProgress;
        if (isDetectingWallet) {
            setConnectButtonText("Loading...");
        } else if (isConnectingWallet) {
            setConnectButtonText("Connecting...");
        } else if (authInProgress) {
            setConnectButtonText("Signing...");
        } else if (isConnected && !isOnBase) {
            setConnectButtonText("Switch Network");
        } else {
            setConnectButtonText("Connect Wallet");
        }
    }

    // Update status message
    if (walletStatus) {
        if (walletErrorMessage && !walletReady) {
            walletStatus.textContent = walletErrorMessage;
            walletStatus.classList.add("error");
        } else if (isConnectingWallet && walletInfoMessage) {
            walletStatus.textContent = walletInfoMessage;
            walletStatus.classList.remove("error");
        } else if (!isConnected && !isConnectingWallet) {
            walletStatus.textContent = "";
            walletStatus.classList.remove("error");
        } else if (!isConnected) {
            walletStatus.textContent = "";
            walletStatus.classList.remove("error");
        } else if (!isOnBase) {
            walletStatus.textContent = "Please switch to Base network.";
            walletStatus.classList.remove("error");
        } else if (!walletAuthenticated) {
            walletStatus.textContent = "";
            walletStatus.classList.remove("error");
        } else {
            walletStatus.textContent = "";
            walletStatus.classList.remove("error");
        }
    }

    // Transition UI state based on wallet status
    if (!canPlayNow) {
        // Wallet disconnected - force back to connect screen from any state
        if (currentUIState === UI_STATE.RUNNING || currentUIState === UI_STATE.PAUSED) {
            gameActive = false;
            isPaused = false;
            gameState = GAME_STATE.GAME_OVER;
        }
        currentUIState = UI_STATE.CONNECT;
        updateUIState();
    } else if (currentUIState === UI_STATE.CONNECT) {
        // Wallet connected - move to menu
        currentUIState = UI_STATE.MENU;
        updateUIState();
    }
    
    // Update start button
    if (startButton) {
        startButton.disabled = !canPlayNow;
    }
    if (payGameButton) {
        payGameButton.disabled = !canPlayNow;
    }
    
    updateCheckinUI();
}

async function disconnectWallet() {
    // Notify wagmi bridge to disconnect (React side)
    if (window.__walletBridge?.disconnect) {
        try { window.__walletBridge.disconnect(); } catch (e) { /* ignore */ }
        window.__walletBridge = null;
    }
    // Disconnect WalletConnect modal if active
    if (activeWalletType === 'walletconnect' && window.web3modal) {
        try { await window.web3modal.disconnect(); } catch (e) { /* ignore */ }
        window.web3modalProvider = null;
    }
    // Clear all wallet state
    walletAddress = null;
    walletChainId = null;
    activeWalletType = null;
    walletAuthenticated = false;
    walletBasename = null;
    window._activeProvider = null;
    resetAuthState();
    clearWalletMessages();
    updateWalletUI();
}

async function applyWalletBridge(detail) {
    walletAddress = detail.address;
    walletChainId = BASE_CHAIN_ID;
    activeWalletType = 'injected';
    window._activeProvider = detail.provider;
    authToken = detail.token;
    walletAuthenticated = true;
    isDetectingWallet = false;
    isConnectingWallet = false;

    // Transition to MENU immediately — don't wait for profile fetch
    currentUIState = UI_STATE.MENU;
    updateWalletUI();  // sets walletReady=true, enables buttons
    updateUIState();   // shows overlay-menu

    // Load profile in background (coins, characters, checkin)
    if (BACKEND_URL && authToken) {
        fetch(`${BACKEND_URL}/api/user/me`, {
            headers: { Authorization: `Bearer ${authToken}` }
        }).then(r => r.ok ? r.json() : null)
          .then(data => {
              if (data?.ok) {
                  applyProfileData(data);
                  resolveBasename(walletAddress);
              }
          })
          .catch(err => console.warn('[bridge] profile fetch failed:', err.message));
    }
}

function isReactBridgePresent() {
    // React mounts into #wallet-root. If it exists, React handles wallet/auth.
    return !!document.getElementById('wallet-root');
}

async function initWalletState() {
    // If React bridge already fired before DOMContentLoaded, use it
    if (window.__walletBridge?.token) {
        await applyWalletBridge(window.__walletBridge);
        return;
    }

    // Listen for React bridge event (fires when wagmi + SIWE auth complete)
    // NOT { once: true } — useGameBridge may re-dispatch when capabilities change
    window.addEventListener('walletBridgeReady', async (e) => {
        if (e.detail?.token) await applyWalletBridge(e.detail);
    });

    // If React is present, skip script.js's own connect/auth flow entirely
    // (React handles: wallet selection, SIWE sign, session restore).
    if (isReactBridgePresent()) {
        isDetectingWallet = false;
        updateWalletUI();
        return;
    }

    // Wait for provider to be injected (some wallets load asynchronously)
    isDetectingWallet = true;
    updateWalletUI();

    const provider = await waitForEthereumProvider(3000);
    isDetectingWallet = false;
    
    // No provider available
    if (!provider) {
        updateWalletUI();
        return;
    }
    
    // ALWAYS set up event listeners first
    if (provider && provider.on) {
        provider.on("accountsChanged", handleAccountsChanged);
        provider.on("chainChanged", handleChainChanged);
    }
    
    // Inside mobile wallet app (Base App, MetaMask mobile) — auto-connect with popup
    if (isWalletApp()) {
        walletInitializing = true;
        try {
            const accounts = await provider.request({ method: "eth_requestAccounts" });
            if (accounts && accounts.length > 0) {
                walletAddress = accounts[0];
                activeWalletType = 'injected';
                const chainId = await provider.request({ method: "eth_chainId" });
                walletChainId = normalizeChainId(chainId) || chainId;
                if (walletChainId !== BASE_CHAIN_ID) {
                    await switchToBase();
                    const newChainId = await provider.request({ method: "eth_chainId" });
                    walletChainId = normalizeChainId(newChainId) || newChainId;
                }
                walletInitializing = false;
                const restored = await restoreAuthSession();
                if (!restored) await authenticateWallet();
                resolveBasename(walletAddress);
                updateWalletUI();
                return;
            }
        } catch (err) {
            console.error("Auto-connect error:", err);
            walletInitializing = false;
            isConnectingWallet = false;
            updateWalletUI();
        }
    }

    // Desktop / mobile browser — silently check if already connected and session exists
    try {
        if (provider) {
            const accounts = await provider.request({ method: "eth_accounts" });
            if (accounts && accounts.length) {
                const savedToken = getAuthTokenForAddress(accounts[0]);
                if (savedToken) {
                    // Previous session exists — restore silently
                    walletAddress = accounts[0];
                    activeWalletType = 'injected';
                    const chainId = await provider.request({ method: "eth_chainId" });
                    walletChainId = normalizeChainId(chainId) || chainId;
                    await restoreAuthSession();
                }
                // No saved token = don't auto-connect, wait for user to click Connect
            }
        }
    } catch (err) {
        // ignore
    } finally {
        updateWalletUI();
    }
}

async function connectWallet() {
    // If already connected, just handle network switch
    if (walletAddress && activeWalletType) {
        await handleNetworkSwitch();
        return;
    }

    // If a previous attempt is still pending (e.g. wallet never fired reject),
    // invalidate it and let the user try again immediately.
    if (isConnectingWallet) {
        connectAttemptId++;
        isConnectingWallet = false;
        activeWalletType = null;
        clearWalletMessages();
        updateWalletUI();
    }
    // Delegate to React/wagmi modal if available, otherwise fallback
    window.dispatchEvent(new CustomEvent('wallet:openModal'));
}

// Handle network switch after wallet is connected
async function handleNetworkSwitch() {
    const provider = getEthereumProvider();
    if (!provider) return;
    
    clearWalletMessages();
    isConnectingWallet = true;
    setWalletInfo("Switching network...");
    updateWalletUI();
    
    try {
        const chainId = await provider.request({ method: "eth_chainId" });
        const normalizedChainId = normalizeChainId(chainId);
        
        if (normalizedChainId !== BASE_CHAIN_ID) {
            await switchToBase();
        }
        
        // Authenticate if needed
        const activeChainId = normalizeChainId(walletChainId);
        if (walletAddress && activeChainId === BASE_CHAIN_ID && !walletAuthenticated) {
            const restored = await restoreAuthSession();
            if (!restored) {
                authAttempted = false;
                await authenticateWallet();
            }
        }
    } catch (err) {
        console.error("Network switch error:", err);
        setWalletError("Network switch error.");
    } finally {
        isConnectingWallet = false;
        clearWalletMessages();
        updateWalletUI();
    }
}

// Legacy connectWallet logic (now used by connectWithInjected/connectWithCoinbase)
async function connectWalletLegacy() {
    const provider = getEthereumProvider();
    if (!provider || isConnectingWallet) {
        setWalletError("Wallet not found.");
        updateWalletUI();
        return;
    }

    clearWalletMessages();
    isConnectingWallet = true;
    setWalletInfo(walletAddress ? "Opening network switch..." : "Opening wallet...");
    updateWalletUI();
    try {
        if (!walletAddress) {
            const accounts = await provider.request({ method: "eth_requestAccounts" });
            handleAccountsChanged(accounts);
        }
        let chainId = null;
        try {
            chainId = await provider.request({ method: "eth_chainId" });
            handleChainChanged(chainId);
        } catch (err) {
            // Some providers may not support eth_chainId at this moment
        }
        const normalizedChainId = normalizeChainId(chainId || walletChainId);
        if (!normalizedChainId || normalizedChainId !== BASE_CHAIN_ID) {
            const switchResult = await trySwitchToBase();
            if (!switchResult.ok) {
                if (switchResult.error && switchResult.error.code === 4001) {
                    setWalletError("Cancelled in wallet.");
                } else if (switchResult.error && switchResult.error.code === -32002) {
                    setWalletError("Waiting for wallet confirmation.");
                } else if (switchResult.error && switchResult.error.code === 4200) {
                    setWalletError("Wallet does not support network switching. Switch manually.");
                } else if (switchResult.error && switchResult.error.code === -32601) {
                    setWalletError("Wallet does not support network switching. Switch manually.");
                } else {
                    setWalletError("Failed to switch network. Try manually.");
                }
            } else {
                const nextChainId = await provider.request({ method: "eth_chainId" });
                handleChainChanged(nextChainId);
            }
        }
        const activeChainId = normalizeChainId(walletChainId);
        if (walletAddress && activeChainId === BASE_CHAIN_ID && !walletAuthenticated) {
            const restored = await restoreAuthSession();
            if (!restored) {
                authAttempted = false;
                await authenticateWallet();
            }
        }
    } catch (err) {
        if (err && err.code === 4001) {
            setWalletError("Cancelled in wallet.");
        } else if (err && err.code === -32002) {
            setWalletError("Waiting for wallet confirmation.");
        } else if (err && err.code === 4200) {
            setWalletError("Wallet does not support network switching. Switch manually.");
        } else {
            setWalletError("Failed to connect wallet. Check permissions.");
        }
    } finally {
        isConnectingWallet = false;
        setWalletInfo("");
        updateWalletUI();
    }
}

async function switchToBase() {
    const result = await trySwitchToBase();
    if (!result.ok && result.error) {
        console.error("Failed to switch network:", result.error);
    }
    return result.ok;
}

async function trySwitchToBase() {
    const provider = getEthereumProvider();
    if (!provider || !provider.request) {
        return { ok: false, error: null };
    }
    try {
        await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BASE_CHAIN_ID }]
        });
        return { ok: true };
    } catch (err) {
        if (err && err.code === 4902) {
            try {
                await provider.request({
                    method: "wallet_addEthereumChain",
                    params: [BASE_CHAIN_PARAMS]
                });
                return { ok: true };
            } catch (addErr) {
                return { ok: false, error: addErr };
            }
        } else if (err && err.code === 4001) {
            return { ok: false, error: err };
        } else {
            return { ok: false, error: err };
        }
    }
}

function handleAccountsChanged(accounts) {
    const previousAddress = walletAddress;
    if (accounts && accounts.length) {
        walletAddress = accounts[0];
    } else {
        // Ignore empty accounts during initialization (Base app sends [] then [addr])
        if (walletInitializing) return;
        walletAddress = null;
    }

    // If same address, skip full reset
    if (previousAddress && walletAddress && previousAddress.toLowerCase() === walletAddress.toLowerCase()) {
        updateWalletUI();
        return;
    }

    resetAuthState();
    checkinState.lastCheckin = null;
    checkinState.streak = 0;
    checkinState.message = "";
    clearWalletMessages();

    // If wallet was disconnected or changed, clear all cached data
    if (previousAddress && (!walletAddress || walletAddress.toLowerCase() !== previousAddress.toLowerCase())) {
        
        // Clear sprite cache
        Object.values(spriteCache).forEach(url => {
            if (url && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        });
        Object.keys(spriteCache).forEach(key => delete spriteCache[key]);
        spritesLoaded = false;
        
        // Reset character state
        ownedCharacters = [];
        selectedCharacter = 0;
        hasFreeMint = false;
        coinCount = 0;
        bestScore = 0;
        rawScore = 0;
        score = 0;
        
        // Clear localStorage
        localStorage.removeItem('selectedCharacter');
        localStorage.removeItem('coinCount');
        localStorage.removeItem('baseapp_runner_best_score');
        
        // Clear player sprite
        if (typeof playerImg !== 'undefined' && playerImg) {
            playerImg.src = '';
        }
        
        // Force exit if was playing
        if (previousAddress && !walletAddress) {
            forceExitToMenu('Wallet disconnected');
        } else {
            forceExitToMenu('Wallet changed');
        }
    }
    
    // Fetch chainId if missing before updating UI
    if (walletAddress && !walletChainId) {
        const provider = getEthereumProvider();
        if (provider) {
            provider.request({ method: "eth_chainId" }).then(cid => {
                walletChainId = normalizeChainId(cid) || cid;
                openWalletMenu();
                updateWalletUI();
                if (walletAddress) {
                    void restoreAuthSession().then(updateWalletUI).catch(err => console.warn('Auth restore failed:', err));
                }
            }).catch(() => {
                openWalletMenu();
                updateWalletUI();
            });
            return;
        }
    }
    openWalletMenu();
    updateWalletUI();
    if (walletAddress) {
        void restoreAuthSession().then(updateWalletUI).catch(err => console.warn('Auth restore failed:', err));
    }
}

function handleChainChanged(chainId) {
    const newChainId = normalizeChainId(chainId) || chainId;
    const chainActuallyChanged = walletChainId && walletChainId !== newChainId;
    walletChainId = newChainId;

    // Don't reset auth during wallet initialization (switchToBase triggers this)
    if (walletInitializing) return;

    if (chainActuallyChanged) {
        resetAuthState();
        checkinState.message = "";
        clearWalletMessages();
    }
    openWalletMenu();
    updateWalletUI();
    if (walletAddress && chainActuallyChanged) {
        void restoreAuthSession().then(updateWalletUI).catch(err => console.warn('Auth restore failed:', err));
    }
}

function getBirdFlyY() {
    // Bird flies at head level - hits standing player but misses ducking player
    // Bird bottom must be ABOVE ducking player's head for duck to work
    // duckHeight/playerHeight ≈ 0.69, so we need multiplier > 0.69
    const birdBottom = groundY - playerHeight * 0.68; // ~68% up from feet (below duck height ~0.69)
    return Math.round(birdBottom - birdHeight);
}

// Player image
let playerImg;
let isDucking = false;
let playerSpriteInsetX = 0;

// Debug mode flag (set to true to visualize hitboxes)
let debugHitboxes = false;

// Minimum horizontal gap between obstacles (in design units)
  const SPAWN_X_GAP = 350;
let spawnXGap = SPAWN_X_GAP;

// Reusable hitbox scratch objects to reduce GC
const playerHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const tokenHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const birdHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const playerBirdHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const coinHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const stickHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const playerDrawRectScratch = { x: 0, y: 0, width: 0, height: 0 };
const birdInsetScratch = { top: 3, bottom: 3, left: 3, right: 3 };

// Normalized opaque bounds for sprite images (0..1)
const spriteBounds = {
    player: null,
    coin: null,
    bird: null
};

function isSpawnXClear(spawnX, minGap) {
    for (let i = 0; i < tokenArray.length; i++) {
        if (Math.abs(tokenArray[i].x - spawnX) < minGap) return false;
    }
    for (let i = 0; i < birdArray.length; i++) {
        if (Math.abs(birdArray[i].x - spawnX) < minGap) return false;
    }
    return true;
}

function adjustSpawnX(spawnX, minGap) {
    let adjusted = spawnX;
    let attempts = 0;
    while (!isSpawnXClear(adjusted, minGap) && attempts < 5) {
        adjusted += minGap;
        attempts++;
    }
    if (!isSpawnXClear(adjusted, minGap)) return null; // skip spawn if no safe position
    return adjusted;
}

// Player object (positions updated by applyGameScale)
let player = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
};

// Obstacles arrays
let tokenArray = [];
let birdArray = [];
let tokenImg;
let birdImg;
let scoreFloat = 0;

const GAME_STATE = {
    RUNNING: "RUNNING",
    GAME_OVER: "GAME_OVER"
};
let gameState = GAME_STATE.RUNNING;
let gameOverTimestamp = 0;
let gameOver = false;
let rawScore = 0;
let score = 0;
let bestScore = 0;

window.onload = function() {
    board = document.getElementById("board");
    
    // Overlay elements
    overlayConnect = document.getElementById("overlay-connect");
    overlayMenu = document.getElementById("overlay-menu");
    overlayPause = document.getElementById("overlay-pause");
    pauseButton = document.getElementById("pause-button");
    connectButton = document.getElementById("connect-button");
    connectStandardBtn = document.getElementById("connect-standard-btn");
    walletStatus = document.getElementById("wallet-status");
    walletAddressDisplay = document.getElementById("wallet-address");
    startButton = document.getElementById("start-button");
    payGameButton = document.getElementById("pay-game-button");
    resumeButton = document.getElementById("resume-button");
    homeButtonPause = document.getElementById("home-button-pause");
    checkinButton = document.getElementById("checkin-button");
    checkinStatus = document.getElementById("checkin-status");
    checkinButtonPause = document.getElementById("checkin-button-pause");
    checkinStatusPause = document.getElementById("checkin-status-pause");
    testNotificationButton = document.getElementById("test-notification-button");
    testNotificationButtonPause = document.getElementById("test-notification-button-pause");

    // Disconnect buttons — hide only inside mobile wallet apps (Base App, MetaMask mobile, etc.)
    const disconnectBtn = document.getElementById("disconnect-button");
    const disconnectBtnPause = document.getElementById("disconnect-button-pause");
    if (isWalletApp()) {
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        if (disconnectBtnPause) disconnectBtnPause.style.display = 'none';
    } else {
        function handleDisconnect(e) {
            e.stopPropagation();
            e.preventDefault();
            disconnectWallet();
        }
        if (disconnectBtn) {
            disconnectBtn.addEventListener("click", handleDisconnect);
            disconnectBtn.addEventListener("touchend", handleDisconnect, { passive: false });
        }
        if (disconnectBtnPause) {
            disconnectBtnPause.addEventListener("click", handleDisconnect);
            disconnectBtnPause.addEventListener("touchend", handleDisconnect, { passive: false });
        }
    }
    
    // Collection elements
    overlayCollection = document.getElementById("overlay-collection");
    collectionButton = document.getElementById("collection-button");
    collectionButtonPause = document.getElementById("collection-button-pause");
    collectionCloseBtn = document.getElementById("collection-close-btn");
    mintVitalikBtn = document.getElementById("mint-vitalik-btn");
    mintTrumpBtn = document.getElementById("mint-trump-btn");
    collectionHint = document.getElementById("collection-hint");
    
    // Game UI elements
    gameCoinsEl = document.getElementById("game-coins");
    gameScoreEl = document.getElementById("game-score");
    gameBestEl = document.getElementById("game-best");
    gameUIContainer = document.querySelector(".game-ui");
    newRecordEl = document.getElementById("new-record-label");
    gameOverOverlay = document.getElementById("game-over-overlay");

    // Initial state
    showWelcome = true;
    gameActive = false;
    isPaused = false;
    currentUIState = UI_STATE.CONNECT;
    updateUIState();
    
    // Event listeners
    if (startButton) {
        startButton.addEventListener("click", startGameFromWelcome);
        startButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            startGameFromWelcome();
        }, { passive: false });
    }
    if (payGameButton) {
        payGameButton.addEventListener("click", handlePayGame);
        payGameButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            handlePayGame();
        }, { passive: false });
    }
    if (resumeButton) {
        resumeButton.addEventListener("click", resumeGame);
        resumeButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            resumeGame();
        }, { passive: false });
    }
    if (homeButtonPause) {
        homeButtonPause.addEventListener("click", goHome);
        homeButtonPause.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            goHome();
        }, { passive: false });
    }

    // Collection button listeners
    if (collectionButton) {
        collectionButton.addEventListener("click", () => openCollection('menu'));
        collectionButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            openCollection('menu');
        }, { passive: false });
    }
    if (collectionButtonPause) {
        collectionButtonPause.addEventListener("click", () => openCollection('pause'));
        collectionButtonPause.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            openCollection('pause');
        }, { passive: false });
    }
    if (collectionCloseBtn) {
        collectionCloseBtn.addEventListener("click", closeCollection);
        collectionCloseBtn.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            closeCollection();
        }, { passive: false });
    }
    
    // Buy Coins modal
    const buyCoinsBtn = document.getElementById('buy-coins-btn');
    const buyCoinsCloseBtn = document.getElementById('buy-coins-close-btn');
    const mintGcBtn = document.getElementById('mint-gc-btn');
    if (buyCoinsBtn) {
        buyCoinsBtn.addEventListener('click', openBuyCoinsModal);
        buyCoinsBtn.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); openBuyCoinsModal(); }, { passive: false });
    }
    // mint-gc-btn uses onclick attribute in HTML
    if (buyCoinsCloseBtn) {
        buyCoinsCloseBtn.addEventListener('click', closeBuyCoinsModal);
        buyCoinsCloseBtn.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); closeBuyCoinsModal(); }, { passive: false });
    }
    document.querySelectorAll('.buy-coins-package').forEach(btn => {
        const coins = parseInt(btn.dataset.coins);
        btn.addEventListener('click', () => handleBuyCoinsPackage(coins));
        btn.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); handleBuyCoinsPackage(coins); }, { passive: false });
    });

    // Character selection/purchase buttons (for all characters)
    document.querySelectorAll('.char-select-btn').forEach(btn => {
        const card = btn.closest('.character-card');
        if (!card) return;
        const charId = parseInt(card.dataset.charId);
        
        btn.addEventListener("click", () => handleCharacterAction(charId));
        btn.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            handleCharacterAction(charId);
        }, { passive: false });
    });
    
    if (pauseButton) {
        pauseButton.addEventListener("click", togglePause);
        pauseButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            togglePause();
        }, { passive: false });
    }
    if (connectButton) {
        connectButton.addEventListener("click", connectWallet);
        connectButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            connectWallet();
        }, { passive: false });
    }
    if (checkinButton) {
        checkinButton.addEventListener("click", handleCheckin);
        checkinButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            handleCheckin();
        }, { passive: false });
    }
    if (checkinButtonPause) {
        checkinButtonPause.addEventListener("click", handleCheckin);
        checkinButtonPause.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            handleCheckin();
        }, { passive: false });
    }
    if (testNotificationButton) {
        testNotificationButton.addEventListener("click", handleTestNotification);
        testNotificationButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            handleTestNotification();
        }, { passive: false });
    }
    if (testNotificationButtonPause) {
        testNotificationButtonPause.addEventListener("click", handleTestNotification);
        testNotificationButtonPause.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            handleTestNotification();
        }, { passive: false });
    }
    initWalletState();
    fetchGameConfig(); // fire-and-forget

    // Pre-load Web3Modal only for WalletConnect fallback (lazy, non-blocking)
    if (!isMobile() && !window.ethereum) {
        initWeb3Modal().catch(() => {});
    }

    context = board.getContext("2d");

    // Setup crisp rendering
    setupCrispCanvas();
    let _resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(setupCrispCanvas, 150);
    });
    
    // Load platform PNG sprite
    platformImg = new Image();
    platformImg.src = "./assets/platforma.png";
    platformImg.onload = function() {
        // Store aspect ratio for proper scaling
        if (platformImg.width > 0 && platformImg.height > 0) {
            platformAspectRatio = platformImg.width / platformImg.height;
        }
        applyGameScale();
    };

    //load player image (human character) - sprite loaded from backend cache
    playerImg = new Image();
    // Don't set src here - will be loaded from spriteCache after auth
    playerImg.onload = function() {
        spriteBounds.player = getNormalizedSpriteBounds(playerImg);
        applyGameScale();
        context.drawImage(playerImg, player.x, player.y, player.width, player.height);
    };

    //load token image (ground obstacle)
    tokenImg = new Image();
    tokenImg.src = "./assets/coin.png";
    tokenImg.onload = function() {
        spriteBounds.coin = getNormalizedSpriteBounds(tokenImg);
    };

    // load eth icon for coin UI
    ethImg = new Image();
    ethImg.src = "./assets/eth.png";

    //load bird image (flying enemy)
    birdImg = new Image();
    birdImg.src = "./assets/gen_bird.png";
    birdImg.onload = function() {
        spriteBounds.bird = getNormalizedSpriteBounds(birdImg);
    };

    // Load best score from localStorage
    bestScore = parseInt(localStorage.getItem('baseapp_runner_best_score')) || 0;
    coinCount = parseInt(localStorage.getItem(COIN_STORAGE_KEY)) || 0;
    nextCoinScore = 1000;

    drawStaticFrame(); // Draw platform once; full loop starts on game start
    setInterval(placeObstacle, 1000); //1000 milliseconds = 1 second
    document.addEventListener("keydown", movePlayer);
    document.addEventListener("touchstart", handleTouchStart, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: false });
    document.addEventListener("touchcancel", handleTouchEnd, { passive: false });
}

function updateWelcomeVisibility() {
    // Legacy function - now handled by updateUIState
    updateUIState();
}

function canPlayGame() {
    return walletReady || ALLOW_GUEST_PLAY;
}

// Force exit to menu when wallet disconnects or changes
function forceExitToMenu(reason) {
    // Stop game immediately
    gameActive = false;
    isPaused = false;
    gameState = GAME_STATE.GAME_OVER;
    
    // Clear session
    currentSession = null;
    
    // Clear sprite cache (new wallet = need to reload sprites)
    // Revoke blob URLs to free memory
    Object.values(spriteCache).forEach(url => {
        if (url && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
    });
    Object.keys(spriteCache).forEach(key => delete spriteCache[key]);
    spritesLoaded = false;
    
    // Reset character state
    ownedCharacters = [];
    selectedCharacter = 0;
    hasFreeMint = false;
    coinCount = 0;
    bestScore = 0;
    rawScore = 0;
    score = 0;
    
    // Clear localStorage for this wallet's data
    localStorage.removeItem('selectedCharacter');
    localStorage.removeItem('coinCount');
    localStorage.removeItem('baseapp_runner_best_score');
    
    // Clear player sprite
    if (typeof playerImg !== 'undefined' && playerImg) {
        playerImg.src = '';
    }
    
    // Update UI to show reset values
    updateGameUI();
    
    // Force to connect screen
    currentUIState = UI_STATE.CONNECT;
    updateUIState();
    
    // Show message
    if (walletStatus) {
        walletStatus.textContent = reason;
        walletStatus.classList.add('error');
    }
}

function updateUIState() {
    // Hide all overlays first
    if (overlayConnect) overlayConnect.classList.add("hidden");
    if (overlayMenu) overlayMenu.classList.add("hidden");
    if (overlayPause) overlayPause.classList.add("hidden");
    if (overlayCollection) overlayCollection.classList.add("hidden");
    
    // Show the appropriate overlay based on state
    switch (currentUIState) {
        case UI_STATE.CONNECT:
            if (overlayConnect) overlayConnect.classList.remove("hidden");
            break;
        case UI_STATE.MENU:
            if (overlayMenu) overlayMenu.classList.remove("hidden");
            break;
        case UI_STATE.PAUSED:
            if (overlayPause) overlayPause.classList.remove("hidden");
            break;
        case UI_STATE.COLLECTION:
            if (overlayCollection) overlayCollection.classList.remove("hidden");
            break;
        case UI_STATE.RUNNING:
            // No overlay visible during gameplay
            break;
    }
    
    // Manage game loop — only run RAF when game is active
    if (currentUIState === UI_STATE.RUNNING || currentUIState === UI_STATE.PAUSED) {
        startGameLoop();
    }

    // Update pause button visibility
    updatePauseButtonVisibility();
    
    // Update game UI visibility
    updateGameUIVisibility();
    
    // Update wallet address display in menu and pause screen
    if (walletAddressDisplay && walletAddress) {
        const formatted = formatAddress(walletAddress);
        walletAddressDisplay.textContent = formatted;
        const pauseDisplay = document.getElementById("wallet-address-pause");
        if (pauseDisplay) pauseDisplay.textContent = formatted;
    }
    
    // Update start button state
    if (startButton) {
        startButton.disabled = !canPlayGame();
    }
    
    // Update collection button pulse
    updateStartButtonState();
    
    // Sync legacy state variables
    showWelcome = currentUIState !== UI_STATE.RUNNING;
    isPaused = currentUIState === UI_STATE.PAUSED;
    gameActive = currentUIState === UI_STATE.RUNNING || currentUIState === UI_STATE.PAUSED;
}

function saveCoins() {
    localStorage.setItem(COIN_STORAGE_KEY, String(coinCount));
}

function addCoins(amount) {
    if (!amount) return;
    coinCount += amount;
    saveCoins();
}

function updatePauseButtonVisibility() {
    if (!pauseButton) return;
    const shouldShow = isMobileLayout && currentUIState === UI_STATE.RUNNING;
    pauseButton.classList.toggle("hidden", !shouldShow);
}

function updateGameUIVisibility() {
    if (!gameUIContainer) return;
    // Show game UI only when game is running or paused
    if (currentUIState === UI_STATE.RUNNING || currentUIState === UI_STATE.PAUSED) {
        gameUIContainer.style.display = "flex";
    } else {
        gameUIContainer.style.display = "none";
    }
}

let _prevCoins = -1, _prevScore = -1, _prevBest = -1, _prevIsNewRecord = false;
function updateGameUI() {
    if (gameCoinsEl && coinCount !== _prevCoins) {
        gameCoinsEl.textContent = String(coinCount);
        _prevCoins = coinCount;
    }
    if (gameScoreEl && score !== _prevScore) {
        gameScoreEl.textContent = String(score);
        _prevScore = score;
    }
    const isNewRecord = score > 0 && score >= bestScore;
    const bestVal = isNewRecord ? score : bestScore;
    if (gameBestEl && bestVal !== _prevBest) {
        gameBestEl.textContent = String(bestVal);
        _prevBest = bestVal;
    }
    if (newRecordEl && isNewRecord !== _prevIsNewRecord) {
        newRecordEl.style.display = isNewRecord ? '' : 'none';
        _prevIsNewRecord = isNewRecord;
    }
}

function updateMenuState() {
    // Legacy function - most logic moved to updateUIState
    if (startButton) {
        startButton.disabled = !canPlayGame();
    }
    updateCheckinUI();
}

function clampCharacterLevel(level) {
    const parsed = Number(level);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(LEVEL_BONUS.length - 1, Math.floor(parsed)));
}

function getCachedCharacterLevel(characterId) {
    return clampCharacterLevel(characterLevelCache[characterId]?.lvl || 0);
}

function getRunLevelBonus() {
    return LEVEL_BONUS[activeRunLevel] || LEVEL_BONUS[0];
}

function getAdjustedScore(rawScore) {
    return Math.floor(rawScore * getRunLevelBonus().mult);
}

function getCoinsPerScoreMilestone() {
    const baseCoins = isPaidGame ? 5 : 1;
    return baseCoins + getRunLevelBonus().coins;
}

function isRunCharacterLocked() {
    if (activeRunCharacterId === null || gameState !== GAME_STATE.RUNNING) return false;
    return currentUIState === UI_STATE.RUNNING
        || currentUIState === UI_STATE.PAUSED
        || (currentUIState === UI_STATE.COLLECTION && collectionOpenedFrom === 'pause');
}

function lockActiveRunCharacter() {
    activeRunCharacterId = selectedCharacter || 0;
    activeRunLevel = getCachedCharacterLevel(activeRunCharacterId);
}

async function applyProfileData(data) {
    if (!data) return;
    
    // Best score from backend (for anti-cheat)
    if (Number.isFinite(data.bestScore)) {
        const localBest = parseInt(localStorage.getItem('baseapp_runner_best_score')) || 0;
        bestScore = Math.max(localBest, data.bestScore);
        localStorage.setItem("baseapp_runner_best_score", String(bestScore));
    }
    
    // Coins: use backend value as initial, then sync from blockchain
    if (Number.isFinite(data.coinBalance)) {
        coinCount = data.coinBalance;
        saveCoins();
    }
    // Coins are backend-only, already set from data.coinBalance above
    
    // Character data from BACKEND (faster than blockchain)
    if (Array.isArray(data.ownedCharacters)) {
        ownedCharacters = data.ownedCharacters;
        hasFreeMint = ownedCharacters.includes(0);
    }
    if (Number.isFinite(data.selectedCharacter) && !isRunCharacterLocked()) {
        selectedCharacter = data.selectedCharacter;
        localStorage.setItem('selectedCharacter', String(selectedCharacter));
    }
    
    // Checkin stats — use data from verify response first, then refresh from backend
    if (data.checkin) {
        checkinState.lastCheckin = data.checkin.lastCheckin || 0;
        checkinState.streak = data.checkin.streak || 0;
        checkinState.canCheckin = data.checkin.canCheckin ?? true;
    }
    // Refresh in background for accuracy (contract-verified canCheckin)
    getCheckinStats().then(stats => {
        if (stats) {
            checkinState.lastCheckin = stats.lastCheckin;
            checkinState.streak = stats.streak;
            checkinState.canCheckin = stats.canCheckin;
            updateCheckinUI();
        }
    }).catch(() => {});
    
    // Update UI
    loadSelectedCharacter();
    updateCollectionUI();
    updateStartButtonState();
    checkinState.message = "";
    updateCheckinUI();
    updateUIState();
}

function setCheckinButtonText(text) {
    if (checkinButton) checkinButton.textContent = text;
    if (checkinButtonPause) checkinButtonPause.textContent = text;
}

function setCheckinButtonDisabled(disabled) {
    if (checkinButton) checkinButton.disabled = disabled;
    if (checkinButtonPause) checkinButtonPause.disabled = disabled;
}

function setTestNotificationButtonDisabled(disabled) {
    if (testNotificationButton) testNotificationButton.disabled = disabled;
    if (testNotificationButtonPause) testNotificationButtonPause.disabled = disabled;
}

function setCheckinStatusText(text, isSuccess) {
    const updateStatus = (el) => {
        if (!el) return;
        _checkinAnimTimers.forEach(clearTimeout);
        _checkinAnimTimers = [];
        el.style.transition = '';
        el.style.opacity = '';
        el.style.transform = '';
        el.textContent = text;
        if (isSuccess !== undefined) {
            el.classList.toggle("success", isSuccess);
        }
    };
    updateStatus(checkinStatus);
    updateStatus(checkinStatusPause);
}

let _checkinAnimTimers = [];

function showCheckinRewardAnimation(rewardText) {
    _checkinAnimTimers.forEach(clearTimeout);
    _checkinAnimTimers = [];

    const els = [checkinStatus, checkinStatusPause].filter(Boolean);
    if (els.length === 0) return;

    const streakText = `Streak: ${checkinState.streak}`;

    els.forEach(el => {
        el.classList.remove("reward-in", "reward-out");
        el.textContent = rewardText;
        el.classList.add("success");
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.transform = 'translateY(4px)';
        void el.offsetHeight;
        el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    });

    _checkinAnimTimers.push(setTimeout(() => {
        els.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-4px)';
        });

        _checkinAnimTimers.push(setTimeout(() => {
            els.forEach(el => {
                el.style.transition = 'none';
                el.style.opacity = '0';
                el.style.transform = 'translateY(4px)';
                el.textContent = streakText;
                void el.offsetHeight;
                el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            });

            _checkinAnimTimers.push(setTimeout(() => {
                els.forEach(el => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                });
            }, 400));
        }, 350));
    }, 1700));
}

function updateCheckinUI() {
    if (!checkinButton && !checkinButtonPause) return;
    
    if (!walletReady) {
        setCheckinButtonDisabled(true);
        setCheckinButtonText("Check-in");
        setCheckinStatusText("", false);
        return;
    }
    if (!authToken) {
        setCheckinButtonDisabled(true);
        setCheckinButtonText("Check-in");
        setCheckinStatusText("Not available", false);
        return;
    }
    if (checkinState.loading) {
        setCheckinButtonDisabled(true);
        setCheckinButtonText("Loading...");
        setCheckinStatusText("", false);
        return;
    }
    const checkedIn = !checkinState.canCheckin;
    setCheckinButtonDisabled(checkedIn);
    setCheckinButtonText(checkedIn ? "Done" : "Check-in");

    if (checkinState.message) {
        setCheckinStatusText(checkinState.message, checkedIn);
    } else if (checkedIn) {
        setCheckinStatusText(`Streak: ${checkinState.streak}`, true);
    } else {
        setCheckinStatusText(`Streak: ${checkinState.streak}`, false);
    }
}

async function handleCheckin() {
    if (!walletReady || !walletAddress || checkinState.loading) {
        updateCheckinUI();
        return;
    }
    
    if (!authToken) {
        checkinState.message = "Not authorized";
        updateCheckinUI();
        return;
    }
    
    checkinState.message = "";
    checkinState.loading = true;
    updateCheckinUI();
    
    try {
        // Check if can checkin from contract
        const stats = await getCheckinStats();
        if (stats && !stats.canCheckin) {
            checkinState.lastCheckin = stats.lastCheckin;
            checkinState.streak = stats.streak;
            checkinState.message = "Already checked in today";
            return;
        }

        const expectedReward = stats ? stats.nextReward : 1;

        setCheckinStatusText(`Please wait... (+${expectedReward} coins)`, false);

        const result = await sendCheckinTransaction();

        checkinState.lastCheckin = Date.now();
        checkinState.streak = result.streak;
        checkinState.canCheckin = false;
        coinCount = result.newBalance;
        saveCoins();
        updateCollectionCoins();
        
        const isBonus = checkinState.streak > 0 && checkinState.streak % 5 === 0;
        checkinState._rewardAnim = isBonus
            ? `+${expectedReward} coins (bonus!)`
            : `+${expectedReward} coin`;
        checkinState.message = "";
            
    } catch (err) {
        console.warn("Check-in failed", err);
        if (err.message && err.message.includes("TooEarlyToCheckin")) {
            checkinState.message = "Already checked in today";
        } else if (err.message && err.message.includes("user rejected")) {
            checkinState.message = "Transaction cancelled";
        } else {
            checkinState.message = "Check-in failed. Try again.";
        }
        // Clear error message after 3s so streak shows again
        setTimeout(() => {
            checkinState.message = "";
            updateCheckinUI();
        }, 3000);
    } finally {
        checkinState.loading = false;
        const pendingReward = checkinState._rewardAnim;
        checkinState._rewardAnim = null;
        updateCheckinUI();
        if (pendingReward) {
            showCheckinRewardAnimation(pendingReward);
        }
    }
}

async function handleTestNotification() {
    if (!walletReady || !walletAddress || !authToken) {
        setCheckinStatusText("Connect wallet first", false);
        return;
    }

    setTestNotificationButtonDisabled(true);
    setCheckinStatusText("Sending test notification...", false);

    try {
        const statusRes = await fetch(`${BACKEND_URL}/api/user/notification-status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const status = await statusRes.json().catch(() => ({}));
        if (statusRes.ok && status.ok) {
            if (!status.saved) {
                setCheckinStatusText("Save app in Base first", false);
                return;
            }
            if (!status.notificationsEnabled) {
                setCheckinStatusText("Enable notifications in Base", false);
                return;
            }
        }

        const res = await fetch(`${BACKEND_URL}/api/user/test-notification`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json().catch(() => ({}));
        const result = Array.isArray(data?.data?.results) ? data.data.results[0] : null;

        if (res.ok && data.ok && (data.data?.sentCount > 0 || result?.sent === true)) {
            setCheckinStatusText("Notification sent", true);
        } else if (result?.failureReason) {
            setCheckinStatusText(result.failureReason, false);
        } else {
            setCheckinStatusText(data.error || "Notification failed", false);
        }
    } catch (err) {
        console.warn("Test notification failed", err);
        setCheckinStatusText("Notification failed", false);
    } finally {
        setTestNotificationButtonDisabled(false);
    }
}

// ============ Paid Game ============

let payGameInFlight = false;

async function handlePayGame() {
    if (payGameInFlight) return;
    if (!walletReady || !walletAddress || !authToken) {
        updateWalletUI();
        return;
    }
    if (needsFreeClaim()) {
        openCollection();
        return;
    }
    if (!gameConfig.treasuryAddress) {
        alert("Paid games are not available yet.");
        return;
    }
    payGameInFlight = true;

    if (payGameButton) {
        payGameButton.disabled = true;
        payGameButton.textContent = "Sending...";
    }

    try {
        const provider = getEthereumProvider();
        const priceHex = '0x' + BigInt(gameConfig.paidGamePriceWei).toString(16);
        let txHash;

        // Try EIP-5792 wallet_sendCalls first (Base App / Coinbase Smart Wallet)
        const paymentsIface = new ethers.Interface(PAYMENTS_ABI);
        const playCalldata = paymentsIface.encodeFunctionData("playPaidGame") + BUILDER_CODE_SUFFIX.slice(2);
        const bridge = window.__walletBridge;

        if (bridge?.sendCalls) {
            try {
                const pmCaps = PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY')
                    ? { paymasterService: { url: PAYMASTER_URL } }
                    : {};
                const raw = await bridge.sendCalls({
                    account: walletAddress,
                    chainId: 8453,
                    calls: [{ to: PAYMENTS_CONTRACT, value: BigInt(gameConfig.paidGamePriceWei), data: playCalldata }],
                    capabilities: pmCaps
                });
                const callsId = extractCallsId(raw);
                if (!callsId) throw new Error('sendCalls returned no id');
                if (payGameButton) payGameButton.textContent = "Confirming...";
                txHash = await waitForBridgeCallsTxHash(callsId);
            } catch (e) {
                if (e.code !== -32601) throw e;
            }
        }

        if (!txHash && provider?.request) {
            try {
                const pmCaps = PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY')
                    ? { paymasterService: { url: PAYMASTER_URL } }
                    : {};
                const raw = await provider.request({
                    method: 'wallet_sendCalls',
                    params: [{
                        version: '1.0',
                        chainId: '0x2105',
                        from: walletAddress,
                        calls: [{ to: PAYMENTS_CONTRACT, value: priceHex, data: playCalldata }],
                        capabilities: pmCaps
                    }]
                });
                const callsId = extractCallsId(raw);
                if (!callsId) throw new Error('wallet_sendCalls returned no id');
                if (payGameButton) payGameButton.textContent = "Confirming...";
                txHash = await waitForCallsTxHash(provider, callsId);
            } catch (e) {
                if (e.code === -32601) {
                    // wallet_sendCalls not supported — fall through to ethers
                } else {
                    throw e;
                }
            }
        }

        // Fallback: ethers contract call
        if (!txHash && bridge?.sendTransaction) {
            txHash = await bridge.sendTransaction({
                to: PAYMENTS_CONTRACT,
                value: BigInt(gameConfig.paidGamePriceWei),
                data: playCalldata
            });
            if (payGameButton) payGameButton.textContent = "Confirming...";
            if (provider) {
                const ethersProvider = new ethers.BrowserProvider(provider);
                await ethersProvider.waitForTransaction(txHash);
            }
        } else if (!txHash) {
            const ethersProvider = new ethers.BrowserProvider(provider);
            const signer = await ethersProvider.getSigner();
            const paymentsContract = new ethers.Contract(PAYMENTS_CONTRACT, PAYMENTS_ABI, signer);
            const populated = await paymentsContract.playPaidGame.populateTransaction({ value: BigInt(gameConfig.paidGamePriceWei) });
            populated.data = populated.data + BUILDER_CODE_SUFFIX.slice(2);
            const tx = await signer.sendTransaction(populated);
            if (payGameButton) payGameButton.textContent = "Confirming...";
            const receipt = await tx.wait();
            txHash = receipt.hash || tx.hash;
        }

        isPaidGame = true;
        pendingPaidTxHash = txHash;

        // Start the game
        await loadCharacterLevels();
        updatePlayerSprite();
        currentUIState = UI_STATE.RUNNING;
        showWelcome = false;
        gameActive = false;
        isPaused = false;
        updateUIState();
        startGameLoop();
        await restartGame();

    } catch (err) {
        console.warn("Pay game failed:", err);
        isPaidGame = false;
        pendingPaidTxHash = null;
        if (err.code === 4001 || (err.message && err.message.includes("user rejected"))) {
            // User cancelled — silent
        } else {
            alert("Payment failed. Please try again.");
        }
    } finally {
        payGameInFlight = false;
        if (payGameButton) {
            payGameButton.disabled = false;
            payGameButton.textContent = "Pay Game · $0.01";
        }
    }
}

// ============ Shop Functions ============

// Shop state
let shopState = {
    characters: [],
    inventory: [],
    availableCoins: 0,
    hasClaimedFree: false,
    loading: false,
    pendingPurchase: null
};

// Load shop characters
async function loadShopCharacters() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/shop/characters`);
        const data = await response.json();
        if (data.ok) {
            shopState.characters = data.characters;
        }
    } catch (err) {
        console.warn("Failed to load shop characters", err);
    }
}

// Load user inventory
async function loadUserInventory() {
    if (!walletReady || !authToken) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/shop/inventory`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (data.ok) {
            shopState.inventory = data.inventory;
            shopState.availableCoins = data.availableCoins;
            shopState.hasClaimedFree = data.hasClaimedFree;
        }
    } catch (err) {
        console.warn("Failed to load inventory", err);
    }
}

// Claim free character
async function claimFreeCharacter() {
    if (!walletReady || !NFT_CONTRACT_ADDRESS) {
        console.warn("Cannot claim: wallet not ready or contract not set");
        return { ok: false, error: "Wallet not ready" };
    }
    
    shopState.loading = true;
    
    try {
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);
        
        // Check if can claim
        const canClaim = await contract.canClaimFreeMint(walletAddress);
        if (!canClaim) {
            return { ok: false, error: "Already claimed or not available" };
        }
        
        // Send transaction
        const tx = await sendWithBuilderCode(signer, contract, 'mintFreeCharacter');
        const receipt = await tx.wait();

        // Mark as claimed on backend
        await fetch(`${BACKEND_URL}/api/shop/claim-free`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ txHash: receipt.hash })
        });
        
        shopState.hasClaimedFree = true;
        await loadUserInventory();
        
        return { ok: true, txHash: receipt.hash };
    } catch (err) {
        console.warn("Claim free character failed", err);
        return { ok: false, error: err.message || "Transaction failed" };
    } finally {
        shopState.loading = false;
    }
}

// Request purchase signature from backend
async function requestPurchaseSignature(charId) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    try {
        const response = await fetch(`${BACKEND_URL}/api/shop/purchase/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ characterId: charId }),
            signal: controller.signal
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || 'Failed to start purchase');
        return data; // { nonce, expiry, signature, price }
    } finally {
        clearTimeout(timeoutId);
    }
}

// Confirm purchase with backend after tx confirmed
async function confirmPurchaseOnBackend(nonce, txHash) {
    const response = await fetch(`${BACKEND_URL}/api/shop/purchase/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ nonce, txHash })
    });
    return response.json();
}

// Cancel pending purchase on backend (on tx failure)
async function cancelPurchaseOnBackend(nonce) {
    try {
        await fetch(`${BACKEND_URL}/api/shop/purchase/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ nonce })
        });
    } catch (e) {
        console.warn('Failed to cancel purchase on backend:', e);
    }
}

// Check if user needs to claim free character before playing
function needsFreeClaim() {
    return walletReady && !hasFreeMint;
}

// ── Buy Coins ────────────────────────────────────────────────────────────────

function openBuyCoinsModal() {
    const el = document.getElementById('overlay-buy-coins');
    if (el) el.classList.remove('hidden');
    const status = document.getElementById('buy-coins-status');
    if (status) status.textContent = '';
    document.querySelectorAll('.buy-coins-package').forEach(btn => {
        btn.disabled = false;
        const coins = btn.dataset.coins;
        btn.querySelector('.pkg-coins').textContent = coins;
    });
}

function closeBuyCoinsModal() {
    const el = document.getElementById('overlay-buy-coins');
    if (el) el.classList.add('hidden');
}

async function handleBuyCoinsPackage(coins) {
    if (!walletReady || !walletAddress || !authToken) return;
    if (!gameConfig.treasuryAddress) {
        alert('Store not available yet.');
        return;
    }

    const usdcAmount = COIN_PACKAGE_USDC.get(coins) ?? (USDC_PER_COIN * BigInt(coins));
    const statusEl = document.getElementById('buy-coins-status');
    const allPkgBtns = document.querySelectorAll('.buy-coins-package');
    const closeBtn = document.getElementById('buy-coins-close-btn');

    allPkgBtns.forEach(b => { b.disabled = true; });
    if (closeBtn) closeBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Confirm in wallet…';

    try {
        const provider = getEthereumProvider();
        const usdcIface = new ethers.Interface(["function approve(address,uint256) returns (bool)"]);
        const paymentsIface = new ethers.Interface(PAYMENTS_ABI);

        // approve(paymentsContract, usdcAmount) + buyCoins(coins, usdcAmount) — batched in one tx
        const approveData = usdcIface.encodeFunctionData("approve", [PAYMENTS_CONTRACT, usdcAmount]);
        const buyData = paymentsIface.encodeFunctionData("buyCoins", [coins, usdcAmount]) + BUILDER_CODE_SUFFIX.slice(2);
        let txHash;
        const bridge = window.__walletBridge;

        // Try EIP-5792 wallet_sendCalls (batches approve + buyCoins atomically, paymaster for gas)
        if (bridge?.sendCalls) {
            try {
                const pmCaps = PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY')
                    ? { paymasterService: { url: PAYMASTER_URL } }
                    : {};
                const raw = await bridge.sendCalls({
                    account: walletAddress,
                    chainId: 8453,
                    calls: [
                        { to: USDC_CONTRACT, value: 0n, data: approveData },
                        { to: PAYMENTS_CONTRACT, value: 0n, data: buyData }
                    ],
                    capabilities: pmCaps
                });
                const callsId = extractCallsId(raw);
                if (!callsId) throw new Error('sendCalls returned no id');
                if (statusEl) statusEl.textContent = 'ConfirmingвЂ¦';
                txHash = await waitForBridgeCallsTxHash(callsId);
            } catch (e) {
                if (e.code !== -32601) throw e;
            }
        }

        if (!txHash && provider?.request) {
            try {
                const pmCaps = PAYMASTER_URL && !PAYMASTER_URL.includes('YOUR_CDP_API_KEY')
                    ? { paymasterService: { url: PAYMASTER_URL } }
                    : {};
                const raw = await provider.request({
                    method: 'wallet_sendCalls',
                    params: [{
                        version: '1.0',
                        chainId: '0x2105',
                        from: walletAddress,
                        calls: [
                            { to: USDC_CONTRACT, value: '0x0', data: approveData },
                            { to: PAYMENTS_CONTRACT, value: '0x0', data: buyData }
                        ],
                        capabilities: pmCaps
                    }]
                });
                const callsId = extractCallsId(raw);
                if (!callsId) throw new Error('wallet_sendCalls returned no id');
                if (statusEl) statusEl.textContent = 'Confirming…';
                txHash = await waitForCallsTxHash(provider, callsId);
            } catch (e) {
                if (e.code !== -32601) throw e;
            }
        }

        // Fallback: two separate transactions (approve then buyCoins)
        if (!txHash && bridge?.sendTransaction) {
            const ethersProvider = provider ? new ethers.BrowserProvider(provider) : null;
            if (statusEl) statusEl.textContent = 'Approve USDCвЂ¦';
            const approveHash = await bridge.sendTransaction({
                to: USDC_CONTRACT,
                value: 0n,
                data: approveData
            });
            if (ethersProvider) await ethersProvider.waitForTransaction(approveHash);
            if (statusEl) statusEl.textContent = 'Buying coinsвЂ¦';
            txHash = await bridge.sendTransaction({
                to: PAYMENTS_CONTRACT,
                value: 0n,
                data: buyData
            });
            if (statusEl) statusEl.textContent = 'ConfirmingвЂ¦';
            if (ethersProvider) await ethersProvider.waitForTransaction(txHash);
        } else if (!txHash) {
            const ethersProvider = new ethers.BrowserProvider(provider);
            const signer = await ethersProvider.getSigner();
            const usdcContract = new ethers.Contract(USDC_CONTRACT,
                ["function approve(address,uint256) returns (bool)"], signer);
            const paymentsContract = new ethers.Contract(PAYMENTS_CONTRACT, PAYMENTS_ABI, signer);
            if (statusEl) statusEl.textContent = 'Approve USDC…';
            const approveTx = await usdcContract.approve(PAYMENTS_CONTRACT, usdcAmount);
            await approveTx.wait();
            if (statusEl) statusEl.textContent = 'Buying coins…';
            const buyTx = await paymentsContract.buyCoins(coins, usdcAmount);
            if (statusEl) statusEl.textContent = 'Confirming…';
            const receipt = await buyTx.wait();
            txHash = receipt.hash;
        }

        if (statusEl) statusEl.textContent = 'Saving…';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
        try {
            const response = await fetch(`${BACKEND_URL}/api/shop/buy-coins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({ coins, txHash }),
                signal: controller.signal
            });
            const data = await response.json();
            if (data.ok) {
                coinCount = data.newBalance;
                saveCoins();
                updateCollectionCoins();
                if (statusEl) statusEl.textContent = `+${data.coinsAdded} coins! Total: ${data.newBalance}`;
                allPkgBtns.forEach(b => { b.disabled = false; });
            } else {
                if (statusEl) statusEl.textContent = data.error || 'Failed to save coins';
                allPkgBtns.forEach(b => { b.disabled = false; });
            }
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (err) {
        console.warn('Buy coins failed:', err);
        const msg = err.code === 4001 || err.code === 'ACTION_REJECTED' ? 'Cancelled' : (err.shortMessage || err.message || 'Failed');
        if (statusEl) statusEl.textContent = msg;
        allPkgBtns.forEach(b => { b.disabled = false; });
    } finally {
        if (closeBtn) closeBtn.disabled = false;
    }
}

// ============ Collection Functions ============

async function loadCharacterLevels() {
    if (!CHARACTER_UPGRADE_ADDRESS || !walletAddress) return;
    try {
        const ethProvider = getEthereumProvider() || window.ethereum;
        if (!ethProvider) return;
        const provider = new ethers.BrowserProvider(ethProvider);
        const contract = new ethers.Contract(CHARACTER_UPGRADE_ADDRESS, CHARACTER_UPGRADE_ABI, provider);
        const ids = [0,1,2,3,4,5,6,7,8,9];
        const [levels, xps] = await contract.getCharacterLevels(walletAddress, ids);
        ids.forEach((id, i) => {
            const lvl = Number(levels[i]);
            const xp  = Number(xps[i]);
            characterLevelCache[id] = {
                lvl,
                xp,
                xpPrev: XP_LEVELS[lvl]     || 0,
                xpNext: XP_LEVELS[lvl + 1] || 0,
            };
        });
        updateCollectionUI();
    } catch (e) {
        console.warn('[upgrade] loadCharacterLevels failed:', e.message);
    }
}

async function checkCollectionStatus() {
    loadSelectedCharacter();
    updateCollectionUI();
    updateStartButtonState();
}

// Spotlight pointer tracking for locked cards
// Static silhouette glow — no pointer tracking (bad on mobile)
// CSS defaults --img-x:50% --img-y:50% already set in stylesheet

// Load silhouette previews for locked character cards
function loadSilhouettes() {
    document.querySelectorAll('.character-card.locked[data-char-id]').forEach(card => {
        const charId = card.getAttribute('data-char-id');
        const silImg = card.querySelector('.char-silhouette');
        if (silImg && !silImg.src.includes('preview')) {
            silImg.src = `${BACKEND_URL}/api/sprites/preview/${charId}`;
        }
    });
}

function updateCollectionUI() {
    // Update all character cards - NO API requests, use cache only
    const cards = document.querySelectorAll('.character-card[data-char-id]');
    const selectionLocked = isRunCharacterLocked();
    
    cards.forEach(card => {
        const charId = parseInt(card.dataset.charId);
        const btn = card.querySelector('.char-select-btn');
        const img = card.querySelector('.character-image img');
        const char = CHARACTERS[charId];
        
        if (!btn || !char) return;
        
        const price = char.price;
        const isOwned = ownedCharacters.includes(charId) || (charId === 0 && hasFreeMint);
        const canAfford = coinCount >= price;
        const isFreeChar = charId === 0;
        
        // Update image - ONLY from cache, no loading
        if (img) {
            if (isOwned && spriteCache[charId]) {
                img.src = spriteCache[charId];
                img.style.display = 'block';
            } else {
                // Hide image for locked - CSS will show placeholder
                img.src = '';
                img.style.display = 'none';
            }
        }
        
        // Update card state
        const lvlInfo = characterLevelCache[charId];

        // ── Level badge — placed inside .character-info next to rarity ────────
        const charInfo = card.querySelector('.character-info');
        let metaRow = card.querySelector('.character-meta-row');
        if (!metaRow && charInfo) {
            const rarityEl = charInfo.querySelector('.character-rarity');
            metaRow = document.createElement('div');
            metaRow.className = 'character-meta-row';
            if (rarityEl) {
                charInfo.insertBefore(metaRow, rarityEl);
                metaRow.appendChild(rarityEl);
            } else {
                charInfo.appendChild(metaRow);
            }
            const lvlBadge = document.createElement('span');
            lvlBadge.className = 'char-level-badge';
            metaRow.appendChild(lvlBadge);
        }
        const lvlBadge = card.querySelector('.char-level-badge');

        // ── Upgrade button ────────────────────────────────────────────────────
        let upgradeBtn = card.querySelector('.char-upgrade-btn');
        if (!upgradeBtn) {
            upgradeBtn = document.createElement('button');
            upgradeBtn.className = 'char-upgrade-btn';
            upgradeBtn.textContent = 'Upgrade ⚡';
            card.appendChild(upgradeBtn);
            const handleUpgrade = (e) => { e.stopPropagation(); openUpgradeModal(charId); };
            upgradeBtn.onclick = handleUpgrade;
            upgradeBtn.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault();
                openUpgradeModal(charId);
            }, { passive: false });
        }

        if (isOwned) {
            card.classList.add('owned');
            card.classList.remove('locked');

            // Level display
            if (lvlBadge) {
                if (lvlInfo) {
                    lvlBadge.textContent = LEVEL_LABELS[lvlInfo.lvl];
                    lvlBadge.className = `char-level-badge level-${lvlInfo.lvl}`;
                    lvlBadge.style.display = '';
                } else {
                    lvlBadge.style.display = 'none';
                }
            }
            upgradeBtn.style.display = (CHARACTER_UPGRADE_ADDRESS && (!lvlInfo || lvlInfo.lvl < 5)) ? '' : 'none';

            if (selectedCharacter === charId) {
                card.classList.add('selected');
                btn.textContent = 'Selected ✓';
                btn.disabled = true;
                btn.classList.remove('btn-primary', 'btn-secondary');
                btn.classList.add('btn-ghost');
            } else if (selectionLocked) {
                card.classList.remove('selected');
                btn.textContent = 'Locked in run';
                btn.disabled = true;
                btn.classList.remove('btn-primary', 'btn-secondary');
                btn.classList.add('btn-ghost');
            } else {
                card.classList.remove('selected');
                btn.textContent = 'Select';
                btn.disabled = false;
                btn.classList.remove('btn-secondary', 'btn-ghost');
                btn.classList.add('btn-primary');
            }
        } else {
            if (lvlBadge) lvlBadge.style.display = 'none';
            upgradeBtn.style.display = 'none';
            card.classList.remove('owned', 'selected');
            card.classList.add('locked');
            
            if (isFreeChar) {
                btn.textContent = 'Free Mint';
                btn.disabled = false;
                btn.classList.remove('btn-secondary', 'btn-ghost');
                btn.classList.add('btn-primary', 'btn-pulse');
            } else if (canAfford) {
                btn.textContent = `${price} Coins`;
                btn.disabled = false;
                btn.classList.remove('btn-secondary', 'btn-ghost');
                btn.classList.add('btn-primary');
            } else {
                btn.textContent = `${price} Coins`;
                btn.disabled = true;
                btn.classList.remove('btn-primary', 'btn-ghost');
                btn.classList.add('btn-secondary');
            }
        }
    });
    
    // Update hint (hidden — moved to collection button text)
    if (collectionHint) {
        collectionHint.textContent = '';
    }

    updateCollectionCoins();
}

function updateStartButtonState() {
    if (!startButton) return;

    const needsMint = needsFreeClaim();

    if (needsMint) {
        startButton.classList.add('btn-locked');
    } else {
        startButton.classList.remove('btn-locked');
    }
    startButton.textContent = 'Free Game';

    if (payGameButton) {
        payGameButton.disabled = needsMint;
        if (needsMint) {
            payGameButton.classList.add('btn-locked');
        } else {
            payGameButton.classList.remove('btn-locked');
        }
    }

    // Collection button: show prompt before free mint, normal text after
    if (collectionButton) {
        collectionButton.textContent = needsMint ? 'Mint your first character to play!' : 'Collection';
        if (needsMint) {
            collectionButton.classList.add('btn-pulse');
        } else {
            collectionButton.classList.remove('btn-pulse');
        }
    }
}

function openCollection(from = 'menu') {
    if (!overlayCollection) return;
    collectionOpenedFrom = from;
    currentUIState = UI_STATE.COLLECTION;
    updateUIState();
    updateCollectionCoins();
    checkCollectionStatus();
    loadSilhouettes();
    loadCharacterLevels();
    updateGCBalance();
}

let gcBalance = 0;

async function updateGCBalance() {
    const el = document.getElementById('collection-gc-count');
    if (!el || !GAMECOIN_ADDRESS || !walletAddress) return;
    try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const gc = new ethers.Contract(GAMECOIN_ADDRESS, GAMECOIN_ABI, provider);
        gcBalance = Number(await gc.balanceOf(walletAddress));
        el.textContent = gcBalance;
    } catch (e) {
        el.textContent = '?';
    }
}

function openMintGCModal() {
    const maxCoins = coinCount || 0;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-box mint-gc-modal">
        <h2 class="modal-title">Mint GC</h2>
        <p class="mint-gc-desc">
          Convert in-game coins to on-chain GC tokens. Spend GC to upgrade characters.<br>
          <strong>1 coin → 5 GC</strong>
        </p>

        <div class="mint-gc-row">
          <span class="mint-gc-label">Coins to spend</span>
          <span class="mint-gc-value" id="mint-coins-val">0</span>
          <span class="mint-gc-balance">/ ${maxCoins}</span>
        </div>

        <input id="mint-gc-slider" class="mint-gc-slider" type="range"
          min="0" max="${maxCoins}" value="0" step="1" ${maxCoins === 0 ? 'disabled' : ''}>

        <div class="mint-gc-result">
          <span>You'll mint</span>
          <span class="mint-gc-result-num" id="mint-gc-out">0</span>
          <span>GC</span>
        </div>

        ${maxCoins === 0 ? '<p class="mint-gc-empty">No coins to convert. Earn coins by playing.</p>' : ''}

        <p id="mint-gc-status" class="mint-gc-status"></p>

        <button id="mint-gc-confirm" class="btn mint-gc-confirm-btn" disabled>Mint GC</button>
        <button id="mint-gc-close" class="btn mint-gc-close-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);

    const statusEl   = modal.querySelector('#mint-gc-status');
    const closeBtn   = modal.querySelector('#mint-gc-close');
    const confirmBtn = modal.querySelector('#mint-gc-confirm');
    const slider     = modal.querySelector('#mint-gc-slider');
    const coinsVal   = modal.querySelector('#mint-coins-val');
    const gcOut      = modal.querySelector('#mint-gc-out');

    const close = () => modal.remove();
    closeBtn.onclick = close;
    closeBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); close(); }, { passive: false });

    if (slider) {
        slider.addEventListener('input', () => {
            const v = parseInt(slider.value);
            coinsVal.textContent = v;
            gcOut.textContent    = v * 5;
            confirmBtn.disabled  = v === 0;
        });
    }

    const doMint = async () => {
        const coinsToSpend = parseInt(slider.value);
        if (!coinsToSpend) return;
        const gcToMint = coinsToSpend * 5;
        confirmBtn.disabled = true;
        statusEl.style.color = '#7fff7f';
        statusEl.textContent = 'Minting GC...';
        try {
            statusEl.textContent = 'Updating balance...';
            const mintRes = await fetch(`${BACKEND_URL}/api/coins/mint-gc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ coinsAmount: coinsToSpend }),
            }).then(r => r.json()).catch(err => ({ ok: false, error: err.message }));

            if (mintRes.ok && typeof mintRes.coinBalance === 'number') {
                coinCount = mintRes.coinBalance;
                localStorage.setItem(COIN_STORAGE_KEY, String(coinCount));
                gcBalance += Number(mintRes.gcAmount || gcToMint);
                const gcCountEl = document.getElementById('collection-gc-count');
                if (gcCountEl) gcCountEl.textContent = gcBalance;
                updateCollectionCoins();
                updateGameUI();
                statusEl.textContent = `Minted ${gcToMint} GC ✓`;
                setTimeout(close, 1200);
            } else {
                statusEl.style.color = '#ff7f7f';
                statusEl.textContent = mintRes.error || 'GC mint failed';
                confirmBtn.disabled = false;
            }
        } catch (e) {
            statusEl.style.color = '#ff7f7f';
            statusEl.textContent = e?.reason || e?.message?.slice(0, 60) || 'Failed';
            confirmBtn.disabled = false;
        }
    };

    confirmBtn.onclick = doMint;
    confirmBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); doMint(); }, { passive: false });
}

// ── Upgrade Modal ─────────────────────────────────────────────────────────────

async function openUpgradeModal(characterId) {
    const char   = CHARACTERS[characterId];
    const lvlInfo = characterLevelCache[characterId] || { lvl: 0, xp: 0, xpNext: 100, xpPrev: 0 };

    // Fetch player's on-chain GC balance
    let gcBalance = 0;
    if (GAMECOIN_ADDRESS) {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const gc = new ethers.Contract(GAMECOIN_ADDRESS, GAMECOIN_ABI, provider);
            gcBalance = Number(await gc.balanceOf(walletAddress));
        } catch (e) { console.warn('[upgrade] gcBalance fetch failed', e.message); }
    }

    const isMaxLevel = lvlInfo.lvl >= 5;
    const maxXP      = isMaxLevel ? 0 : XP_LEVELS[5] - lvlInfo.xp; // can't go past max
    const sliderMax  = Math.min(gcBalance, maxXP);

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-box upgrade-modal">
        <h2 class="modal-title">Upgrade · ${char?.name || 'Character'}</h2>

        <div class="upgrade-level-row">
          <div class="upgrade-level-block current">
            <span class="upgrade-lv-label">Current</span>
            <span class="upgrade-lv-badge level-${lvlInfo.lvl}">${LEVEL_LABELS[lvlInfo.lvl]}</span>
          </div>
          <div class="upgrade-arrow-big">→</div>
          <div class="upgrade-level-block next" id="upg-next-block">
            <span class="upgrade-lv-label">After</span>
            <span class="upgrade-lv-badge level-${lvlInfo.lvl}" id="upg-next-badge">${LEVEL_LABELS[lvlInfo.lvl]}</span>
          </div>
        </div>

        <div class="upgrade-xp-track">
          <span class="upgrade-xp-text" id="upg-xp-text">${lvlInfo.xp} XP</span>
        </div>

        ${isMaxLevel ? `<p class="upgrade-max-msg">MAX LEVEL REACHED</p>` : `
        <div class="upgrade-slider-wrap">
          <label class="upgrade-slider-label">
            GC to spend: <strong id="upg-gc-val">0</strong>
            <span class="upgrade-gc-balance">(balance: ${gcBalance} GC)</span>
          </label>
          <input type="range" class="upgrade-slider" id="upg-slider"
            min="0" max="${sliderMax}" value="0" step="1" ${sliderMax === 0 ? 'disabled' : ''}>
          <div class="upgrade-bonus-preview" id="upg-bonus">
            <span id="upg-bonus-coins"></span>
            <span id="upg-bonus-mult"></span>
          </div>
          ${sliderMax === 0 && !isMaxLevel ? `<p class="upgrade-no-gc">Mint GC first — or earn more in-game coins</p>` : ''}
        </div>
        <p id="upgrade-status" class="upgrade-status"></p>
        <button class="char-upgrade-btn upgrade-confirm-btn" id="upg-confirm-btn" disabled>Upgrade ⚡</button>
        `}

        <div class="upgrade-level-guide">
          <p class="upgrade-guide-title">All level bonuses:</p>
          <table class="upgrade-guide-table">
            <tr><th>Level</th><th>XP</th><th>+coins/1k</th><th>×score</th></tr>
            ${[1,2,3,4,5].map(l => `<tr class="${lvlInfo.lvl >= l ? 'upg-row-done' : ''}"><td>Lv.${l}</td><td>${XP_LEVELS[l]}</td><td>+${LEVEL_BONUS[l].coins}</td><td>×${LEVEL_BONUS[l].mult}</td></tr>`).join('')}
          </table>
        </div>

        <button class="btn btn-ghost upgrade-close-btn">Close</button>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.upgrade-close-btn');
    closeBtn.addEventListener('click', () => modal.remove());
    closeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); modal.remove(); }, { passive: false });

    if (!isMaxLevel && sliderMax > 0) {
        const slider     = modal.querySelector('#upg-slider');
        const gcValEl    = modal.querySelector('#upg-gc-val');
        const nextBadge  = modal.querySelector('#upg-next-badge');
        const xpText     = modal.querySelector('#upg-xp-text');
        const bonusCoins = modal.querySelector('#upg-bonus-coins');
        const bonusMult  = modal.querySelector('#upg-bonus-mult');
        const confirmBtn = modal.querySelector('#upg-confirm-btn');

        slider.addEventListener('input', () => {
            const gc     = parseInt(slider.value);
            const newXP  = lvlInfo.xp + gc;
            const newLvl = getUpgradeLevel(newXP);
            gcValEl.textContent   = gc;
            xpText.textContent    = `${lvlInfo.xp} → ${newXP} XP`;
            nextBadge.textContent = LEVEL_LABELS[newLvl];
            nextBadge.className   = `upgrade-lv-badge level-${newLvl}`;
            bonusCoins.textContent = gc > 0 ? `+${LEVEL_BONUS[newLvl].coins} coin/1k pts` : '';
            bonusMult.textContent  = gc > 0 ? `×${LEVEL_BONUS[newLvl].mult} score`         : '';
            confirmBtn.disabled    = gc === 0;
        });

        const handler = async (e) => {
            if (e.type === 'touchstart') { e.preventDefault(); e.stopPropagation(); }
            const gc = parseInt(slider.value);
            if (gc > 0) await executeUpgrade(characterId, gc, modal);
        };
        confirmBtn.addEventListener('click', handler);
        confirmBtn.addEventListener('touchstart', handler, { passive: false });
    }
}

function xpPct(info) {
    const lvl  = info.lvl ?? getUpgradeLevel(info.xp);
    const prev = XP_LEVELS[lvl]         || 0;
    const next = XP_LEVELS[lvl + 1]     || XP_LEVELS[5];
    if (lvl >= 5) return 100;
    return Math.min(100, Math.round((info.xp - prev) / Math.max(1, next - prev) * 100));
}

function getUpgradeLevel(xp) {
    for (let i = 5; i >= 1; i--) { if (xp >= XP_LEVELS[i]) return i; }
    return 0;
}

async function executeUpgrade(characterId, gcAmount, modal) {
    const statusEl = modal.querySelector('#upgrade-status');
    const pkgBtns  = modal.querySelectorAll('.upgrade-pkg-btn');
    pkgBtns.forEach(b => b.disabled = true);

    function setStatus(msg, isError) {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = isError ? '#ff7f7f' : '#7fff7f'; }
    }

    try {
        const provider = new ethers.BrowserProvider(getEthereumProvider() || window.ethereum);
        const signer   = await provider.getSigner();

        // Base App path: one atomic transaction with approve + upgrade, so GC is actually spent.
        // Fallback wallets may require approve then upgrade.
        setStatus('Sign the upgrade transaction…');
        const tx = await sendUpgradeWithGCSpend(signer, characterId, gcAmount);
        setStatus('Waiting for confirmation…');
        await tx.wait();

        await loadCharacterLevels();
        await updateGCBalance();
        updateCollectionUI();
        setStatus('Upgrade complete! ✓', false);

    } catch (err) {
        console.error('[upgrade] error:', err);
        const msg = err?.reason || err?.message || 'Upgrade failed';
        setStatus(msg.length > 80 ? msg.slice(0, 80) + '…' : msg, true);
        pkgBtns.forEach(b => b.disabled = false);
    }
}

function updateCollectionCoins() {
    const coinsEl = document.getElementById('collection-coins-count');
    if (coinsEl) {
        coinsEl.textContent = coinCount;
    }
}

function closeCollection() {
    // Return to where we came from
    if (collectionOpenedFrom === 'pause') {
        currentUIState = UI_STATE.PAUSED;
    } else {
        currentUIState = UI_STATE.MENU;
    }
    collectionOpenedFrom = null;
    updateUIState();
}

async function handleMintVitalik() {
    const ownsVitalik = hasFreeMint || ownedCharacters.includes(0);
    
    // If already owns, this is a Select action
    if (ownsVitalik) {
        selectCharacter(0);
        return;
    }
    
    if (collectionLoading) return;
    
    collectionLoading = true;
    if (mintVitalikBtn) {
        mintVitalikBtn.textContent = 'Minting...';
        mintVitalikBtn.disabled = true;
    }
    
    try {
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);
        
        // Check if can claim
        const canClaim = await contract.canClaimFreeMint(walletAddress);
        if (!canClaim) {
            alert('Already claimed or not available');
            collectionLoading = false;
            updateCollectionUI();
            return;
        }
        
        // Send transaction
        const tx = await sendWithBuilderCode(signer, contract, 'mintFreeCharacter');
        if (mintVitalikBtn) mintVitalikBtn.textContent = 'Confirming...';
        const receipt = await tx.wait();
        
        // Record on backend
        try {
            const response = await fetch(`${BACKEND_URL}/api/shop/claim-free`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ txHash: receipt.hash, characterId: 0 })
            });
            const data = await response.json();
            if (data.ok && Array.isArray(data.ownedCharacters)) {
                ownedCharacters = data.ownedCharacters;
                hasFreeMint = ownedCharacters.includes(0);
            }
        } catch (e) {
            console.warn('Failed to record mint on backend:', e);
        }

        // Fallback state update if backend call failed
        if (!hasFreeMint) {
            hasFreeMint = true;
            if (!ownedCharacters.includes(0)) ownedCharacters.push(0);
        }
        selectedCharacter = 0; // Auto-select after mint
        
        updateCollectionUI();
        updateStartButtonState();
    } catch (err) {
        console.error('Mint failed:', err);
        if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
            alert('Transaction cancelled');
        } else {
            alert('Mint failed: ' + (err.message || 'Unknown error'));
        }
        updateCollectionUI();
    } finally {
        collectionLoading = false;
    }
}

// Character data - NO local sprites, all loaded from backend
// Prices: FREE=0, COMMON=10, RARE=25, EPIC=50, LEGENDARY=100
const CHARACTERS = {
    0: { name: 'Vitalik', rarity: 'COMMON', price: 0 },
    1: { name: 'Doge', rarity: 'COMMON', price: 10 },
    2: { name: 'Hamaha', rarity: 'COMMON', price: 10 },
    3: { name: 'Hayes', rarity: 'RARE', price: 25 },
    4: { name: 'Pepe', rarity: 'RARE', price: 25 },
    5: { name: 'Elon Mask', rarity: 'EPIC', price: 50 },
    6: { name: 'Sam Bankman', rarity: 'EPIC', price: 50 },
    7: { name: 'Vladimir Novakovski', rarity: 'EPIC', price: 50 },
    8: { name: 'CZ', rarity: 'LEGENDARY', price: 100 },
    9: { name: 'Trump', rarity: 'LEGENDARY', price: 100 }
};

// Cache for loaded real sprites (blob URLs, in-memory)
const spriteCache = {};
let spritesLoaded = false;

// localStorage sprite cache — keyed by wallet address so wallets don't share sprites
function lsSpritKey(address, charId) {
    return `sprite_${address.toLowerCase()}_${charId}`;
}
function lsSelectedKey(address) {
    return `selected_character_${address.toLowerCase()}`;
}
function getSpriteFromLS(address, charId) {
    const key = lsSpritKey(address, charId);
    // Check in-memory cache first
    if (memSpriteCache[key]) return memSpriteCache[key];
    try { return localStorage.getItem(key); } catch { return null; }
}
// In-memory sprite cache (avoid localStorage quota issues in embedded browsers)
const memSpriteCache = {};

function saveSpriteToLS(address, charId, dataUrl) {
    const key = lsSpritKey(address, charId);
    memSpriteCache[key] = dataUrl;
    try { localStorage.setItem(key, dataUrl); } catch (e) {
        // Quota exceeded — clear old sprites to make room for auth tokens
        console.warn('localStorage sprite save failed, clearing old sprites:', e);
        clearOldSprites();
    }
}

function clearOldSprites() {
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sprite_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
}
function getSelectedFromLS(address) {
    try { return localStorage.getItem(lsSelectedKey(address)); } catch { return null; }
}
function saveSelectedToLS(address, charId) {
    try { localStorage.setItem(lsSelectedKey(address), String(charId)); } catch {}
}

// For backwards compatibility
const CHARACTER_PRICES = Object.fromEntries(
    Object.entries(CHARACTERS).map(([id, char]) => [id, char.price])
);

// Load real sprites from backend for owned characters - ONCE at login
async function loadOwnedSprites(forceReload = false) {
    if (!authToken) return;
    if (spritesLoaded && !forceReload) return; // Already loaded, skip
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/sprites`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        if (!data.ok) return;
        
        // Update selected character from backend
        if (data.selectedCharacter !== undefined && !isRunCharacterLocked()) {
            selectedCharacter = data.selectedCharacter;
            localStorage.setItem('selectedCharacter', String(selectedCharacter));
        }
        
        // Update owned characters
        if (Array.isArray(data.ownedCharacters)) {
            ownedCharacters = data.ownedCharacters;
            hasFreeMint = ownedCharacters.includes(0);
        }
        
        // Load sprites — check localStorage first, then fetch from backend
        for (const [charId, spriteUrl] of Object.entries(data.sprites)) {
            const id = String(parseInt(charId));
            if (spriteCache[id]) continue;
            // Try localStorage cache first
            const cached = getSpriteFromLS(walletAddress, id);
            if (cached) {
                spriteCache[id] = cached;
                continue;
            }
            // Fetch from backend and save to localStorage
            try {
                const spriteResponse = await fetch(`${BACKEND_URL}${spriteUrl}`, {
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                if (spriteResponse.ok) {
                    const blob = await spriteResponse.blob();
                    const dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    spriteCache[id] = dataUrl;
                    saveSpriteToLS(walletAddress, id, dataUrl);
                }
            } catch (e) {
                console.warn(`Failed to cache sprite ${id}:`, e);
            }
        }
        
        spritesLoaded = true;
        
        // Update player sprite with cached sprite
        updatePlayerSprite();
        
    } catch (e) {
        console.warn('Failed to load owned sprites:', e);
    }
}

// Load single sprite after purchase
async function loadSpriteForCharacter(charId) {
    if (!authToken || spriteCache[charId]) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/sprites/${charId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
            const blob = await response.blob();
            spriteCache[charId] = URL.createObjectURL(blob);
        }
    } catch (e) {
        console.warn(`Failed to load sprite ${charId}:`, e);
    }
}

// Handle character button click - select if owned, purchase if not
async function handleCharacterAction(charId) {
    const char = CHARACTERS[charId];
    if (!char) {
        console.warn('Character not found:', charId);
        return;
    }
    
    const isOwned = ownedCharacters.includes(charId) || (charId === 0 && hasFreeMint);
    
    if (isOwned) {
        // Already owned - select it
        await selectCharacter(charId);
    } else if (charId === 0) {
        // Free mint
        await handleFreeMint();
    } else {
        // Purchase
        await handlePurchase(charId);
    }
}

// Handle free mint (character 0 - Vitalik)
async function handleFreeMint() {
    if (hasFreeMint) {
        return;
    }
    
    if (collectionLoading) return;
    collectionLoading = true;
    
    // Update button to show loading state
    const vitalikCard = document.querySelector('.character-card[data-char-id="0"]');
    const btn = vitalikCard?.querySelector('.char-select-btn');
    if (btn) {
        btn.textContent = 'Minting...';
        btn.disabled = true;
    }
    
    try {
        // Check if NFT contract is configured
        if (!isValidAddress(NFT_CONTRACT_ADDRESS)) {
            // Fallback to backend-only mint
            await backendOnlyFreeMint();
            return;
        }
        
        // Blockchain mint
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);
        
        // Check if can claim
        const canClaim = await contract.canClaimFreeMint(walletAddress);
        if (!canClaim) {
            alert('Already claimed or not available on-chain');
            collectionLoading = false;
            updateCollectionUI();
            return;
        }
        
        // Send transaction
        if (btn) btn.textContent = 'Confirm in wallet...';
        const tx = await sendWithBuilderCode(signer, contract, 'mintFreeCharacter');
        
        if (btn) btn.textContent = 'Confirming...';
        const receipt = await tx.wait();
        
        // Record on backend
        await recordFreeMintOnBackend(receipt.hash);
        
    } catch (e) {
        console.error('Free mint failed:', e);
        if (e.code === 4001 || e.code === 'ACTION_REJECTED') {
            alert('Transaction cancelled');
        } else if (e.message?.includes('canClaimFreeMint')) {
            // Contract method doesn't exist, fallback to backend
            await backendOnlyFreeMint();
            return;
        } else {
            alert('Mint failed: ' + (e.reason || e.message || 'Unknown error'));
        }
        updateCollectionUI();
    } finally {
        collectionLoading = false;
    }
}

// Fallback: backend-only free mint (no blockchain)
async function backendOnlyFreeMint() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/shop/claim-free`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ characterId: 0 })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            if (Array.isArray(data.ownedCharacters)) {
                ownedCharacters = data.ownedCharacters;
            } else {
                if (!ownedCharacters.includes(0)) ownedCharacters.push(0);
            }
            hasFreeMint = true;
            selectedCharacter = 0; // Auto-select Vitalik
            localStorage.setItem('selectedCharacter', '0');
            
            await loadSpriteForCharacter(0);
            updatePlayerSprite(); // Set player sprite!
            updateCollectionUI();
            updateStartButtonState();
        } else {
            console.error('Backend returned error:', data.error);
            alert(data.error || 'Free mint failed');
        }
    } catch (e) {
        console.error('Backend free mint failed:', e);
        alert('Free mint failed: ' + e.message);
    } finally {
        collectionLoading = false;
        updateCollectionUI();
    }
}

// Record successful blockchain mint on backend
async function recordFreeMintOnBackend(txHash) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/shop/claim-free`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ txHash, characterId: 0 })
        });
        const data = await response.json();
        
        if (data.ok) {
            if (Array.isArray(data.ownedCharacters)) {
                ownedCharacters = data.ownedCharacters;
            } else {
                if (!ownedCharacters.includes(0)) ownedCharacters.push(0);
            }
            hasFreeMint = true;
        }
    } catch (e) {
        console.warn('Failed to record mint on backend:', e);
    }

    // Auto-select Vitalik
    selectedCharacter = 0;
    localStorage.setItem('selectedCharacter', '0');
    
    // Update UI regardless
    await loadSpriteForCharacter(0);
    updatePlayerSprite(); // Set player sprite!
    updateCollectionUI();
    updateStartButtonState();
}

// Handle character purchase
async function handlePurchase(charId) {
    const char = CHARACTERS[charId];
    if (!char || char.price === 0) return;

    if (!walletReady || !isValidAddress(NFT_CONTRACT_ADDRESS) || !authToken) {
        alert('Wallet not connected or not logged in');
        return;
    }

    if (collectionLoading) return;

    collectionLoading = true;
    const card = document.querySelector(`.character-card[data-char-id="${charId}"]`);
    const btn = card ? card.querySelector('.char-select-btn') : null;
    let purchaseNonce = null;

    if (btn) {
        btn.textContent = 'Checking...';
        btn.disabled = true;
    }

    try {
        // Step 1: Get backend signature (verifies coins, reserves them)
        if (btn) btn.textContent = 'Reserving...';
        const voucher = await requestPurchaseSignature(charId);
        purchaseNonce = voucher.nonce;
        if (!voucher.signature) throw new Error('Backend signer not configured');

        // Step 2: User signs one transaction — mint NFT with backend signature
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);

        if (btn) btn.textContent = 'Confirm tx...';
        const tx = await sendWithBuilderCode(signer, nftContract, 'mintWithSignature', [
            charId,
            voucher.nonce,
            voucher.expiry,
            voucher.signature
        ]);

        if (btn) btn.textContent = 'Minting...';
        const receipt = await tx.wait();

        // Step 3: Confirm with backend — deducts coins, marks character owned
        const confirmed = await confirmPurchaseOnBackend(voucher.nonce, receipt.hash);
        if (confirmed.ok) {
            coinCount = confirmed.newBalance;
            saveCoins();
            if (Array.isArray(confirmed.ownedCharacters)) {
                ownedCharacters = confirmed.ownedCharacters;
                hasFreeMint = ownedCharacters.includes(0);
            } else {
                if (!ownedCharacters.includes(charId)) ownedCharacters.push(charId);
            }
        } else {
            if (!ownedCharacters.includes(charId)) ownedCharacters.push(charId);
        }
        if (!isRunCharacterLocked()) {
            selectedCharacter = charId;
            localStorage.setItem('selectedCharacter', String(charId));
            if (walletAddress) saveSelectedToLS(walletAddress, charId);
        }

        await loadSpriteForCharacter(charId);
        updatePlayerSprite();
        updateCollectionUI();
        updateCollectionCoins();
        updateStartButtonState();
    } catch (err) {
        console.error('Purchase failed:', err);

        // Cancel reservation so coins are freed
        if (purchaseNonce) await cancelPurchaseOnBackend(purchaseNonce);

        if (err.code === 4001 || err.code === 'ACTION_REJECTED'
            || (err.message && err.message.includes('user rejected'))) {
            alert('Transaction cancelled');
        } else if (err.message && err.message.includes('SignatureExpired')) {
            alert('Purchase time expired, try again');
        } else if (err.message && err.message.includes('AlreadyOwnsCharacterType')) {
            alert('You already own this character');
        } else {
            alert('Purchase failed: ' + (err.shortMessage || err.message || 'Unknown error'));
        }
        updateCollectionUI();
    } finally {
        collectionLoading = false;
    }
}

// Select a character to play with
async function selectCharacter(charType) {
    const char = CHARACTERS[charType];
    if (!char) return;
    if (isRunCharacterLocked()) {
        console.warn('Cannot select character during an active run:', charType);
        updateCollectionUI();
        return;
    }
    
    // Check ownership
    const isOwned = ownedCharacters.includes(charType) || (charType === 0 && hasFreeMint);
    if (!isOwned) {
        console.warn('Cannot select unowned character:', charType);
        return;
    }
    
    selectedCharacter = charType;
    localStorage.setItem('selectedCharacter', String(charType));
    if (walletAddress) saveSelectedToLS(walletAddress, charType);

    // Update player sprite immediately
    await loadCharacterLevels();
    updatePlayerSprite();
    
    // Update UI
    updateCollectionUI();
    
    // Save to backend (if authenticated)
    if (authToken) {
        try {
            await fetch(`${BACKEND_URL}/api/user/select-character`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ characterId: charType })
            });
        } catch (e) {
            console.warn('Failed to save character selection:', e);
        }
    }
    
}

// Update player sprite based on selected character
function updatePlayerSprite() {
    // Use cached sprite if available
    const cachedSprite = spriteCache[selectedCharacter];
    
    // Update the playerImg if it exists
    if (typeof playerImg !== 'undefined' && playerImg && cachedSprite) {
        playerImg.src = cachedSprite;
    }
    // If no cached sprite, playerImg keeps its current src (or default)
}

// Load selected character from storage (fallback) or backend (primary)
async function loadSelectedCharacter() {
    // Try wallet-specific localStorage first, fallback to generic key
    if (isRunCharacterLocked()) {
        selectedCharacter = activeRunCharacterId ?? selectedCharacter;
    } else {
        const saved = walletAddress
            ? (getSelectedFromLS(walletAddress) || localStorage.getItem('selectedCharacter'))
            : localStorage.getItem('selectedCharacter');
        if (saved !== null) {
            const charType = parseInt(saved);
            if (CHARACTERS[charType]) {
                selectedCharacter = charType;
            } else {
                selectedCharacter = 0;
            }
        }
    }
    
    // Load real sprites from backend ONCE (skips if already loaded)
    await loadOwnedSprites();
    
    // Update sprite from cache
    await loadCharacterLevels();
    updatePlayerSprite();
}

async function startGameFromWelcome() {
    if (!canPlayGame()) {
        updateWalletUI();
        return;
    }
    
    // Check if needs free mint first
    if (needsFreeClaim()) {
        openCollection();
        return;
    }
    
    await loadCharacterLevels();
    updatePlayerSprite();
    
    // Transition to running state
    currentUIState = UI_STATE.RUNNING;
    showWelcome = false;
    gameActive = false;
    isPaused = false;
    updateUIState();
    startGameLoop();
    await restartGame();
}

function goHome() {
    gameState = GAME_STATE.IDLE;
    gameOver = false;
    gameActive = false;
    isPaused = false;
    showWelcome = true;
    resetFullSession();
    currentUIState = canPlayGame() ? UI_STATE.MENU : UI_STATE.CONNECT;
    updateUIState();
    stopGameLoop();
    drawStaticFrame();
}

function openPauseMenu() {
    if (currentUIState !== UI_STATE.RUNNING || gameState === GAME_STATE.GAME_OVER) return;
    currentUIState = UI_STATE.PAUSED;
    isPaused = true;
    showWelcome = true;
    gameActive = true;
    updateUIState();
}

function openWalletMenu() {
    // Force back to connect/menu based on wallet state
    currentUIState = canPlayGame() ? UI_STATE.MENU : UI_STATE.CONNECT;
    showWelcome = true;
    isPaused = false;
    gameActive = false;
    resetFullSession();
    updateUIState();
}

function resumeGame() {
    if (currentUIState !== UI_STATE.PAUSED) return;
    // Check wallet is still connected
    if (!canPlayGame()) {
        openWalletMenu();
        return;
    }
    currentUIState = UI_STATE.RUNNING;
    isPaused = false;
    showWelcome = false;
    gameActive = true;
    updateUIState();
}

function togglePause() {
    if (gameState === GAME_STATE.GAME_OVER) return;
    if (currentUIState === UI_STATE.PAUSED) {
        resumeGame();
        return;
    }
    if (currentUIState === UI_STATE.RUNNING) {
        openPauseMenu();
    }
}

//=============================================================================
// DESIGN-RESOLUTION SCALING SYSTEM
//=============================================================================

// Apply scaling based on canvas dimensions
function applyGameScale() {
    // Scale based on height ratio
    gameScale = boardHeight / BASE_BOARD_HEIGHT;
    
    // Platform position
    platform.x = 0;
    platform.width = boardWidth;
    platform.height = Math.round(PLATFORM_HEIGHT * gameScale);
    platform.y = Math.round(boardHeight * PLATFORM_Y_RATIO);
    
    // Ground baseline = top edge of platform PNG
    groundY = platform.y;
    
    // Scale sprites
    coinSize = Math.round(BASE_COIN_SIZE * gameScale);
    playerWidth = Math.round(BASE_PLAYER_WIDTH * gameScale);
    playerHeight = Math.round(BASE_PLAYER_HEIGHT * gameScale);
    playerDuckHeight = Math.round(BASE_PLAYER_DUCK_HEIGHT * gameScale);
    birdWidth = Math.round(BASE_BIRD_WIDTH * gameScale);
    birdHeight = Math.round(BASE_BIRD_HEIGHT * gameScale);
    stickHeight = Math.round(BASE_STICK_HEIGHT * gameScale);
    stickWidth = Math.max(2, Math.round(BASE_STICK_WIDTH * gameScale));
    coinSpacing = Math.round(BASE_COIN_SPACING * gameScale);
    footOffset = Math.round(BASE_FOOT_OFFSET * gameScale);
    
    // Token sizes (with tighter spacing)
    token1Width = coinSize;
    token2Width = coinSpacing + coinSize;
    token3Width = coinSpacing * 2 + coinSize;
    tokenHeight = Math.round(BASE_TOKEN_HEIGHT * gameScale);
    
    // Positions
    playerSpriteInsetX = spriteBounds.player ? Math.round(spriteBounds.player.x * playerWidth) : 0;
    playerX = Math.round(BASE_PLAYER_X * gameScale) - playerSpriteInsetX;
    playerY = groundY - playerHeight;
    tokenY = groundY - tokenHeight;
    tokenX = boardWidth + Math.round(BASE_SPAWN_OFFSET * gameScale);
    birdX = boardWidth + Math.round(BASE_SPAWN_OFFSET * gameScale);
    birdY = getBirdFlyY();
    
    hitboxPadding = Math.max(2, Math.round(3 * gameScale));
    
    // Update player
    player.x = playerX;
    player.y = playerY;
    player.width = playerWidth;
    player.height = playerHeight;
    
    updatePauseButtonVisibility();
}

function setupCrispCanvas() {
    const viewport = getViewportSize();
    const dpr = window.devicePixelRatio || 1;
    
    isMobileLayout = viewport.width <= 900;
    
    // Get available space from game card or viewport
    const gameCard = document.querySelector('.game-card');
    if (gameCard) {
        const cardRect = gameCard.getBoundingClientRect();
        boardWidth = Math.round(cardRect.width);
        boardHeight = Math.round(cardRect.height);
    } else {
        boardWidth = Math.round(viewport.width * 0.9);
        boardHeight = Math.round(viewport.height * 0.7);
    }
    
    // Ensure minimum size
    boardWidth = Math.max(boardWidth, 300);
    boardHeight = Math.max(boardHeight, 200);
    
    // Set canvas size with DPR
    board.width = Math.floor(boardWidth * dpr);
    board.height = Math.floor(boardHeight * dpr);
    board.style.width = boardWidth + "px";
    board.style.height = boardHeight + "px";
    
    // Scale context
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // Disable smoothing
    context.imageSmoothingEnabled = false;
    
    // Apply scaling
    applyGameScale();

    // Redraw static frame if game loop is not running
    if (!_rafId) {
        drawStaticFrame();
    }
}

// Compute normalized opaque bounds for an image (0..1)
function getNormalizedSpriteBounds(img) {
    const bounds = computeOpaqueBounds(img);
    return {
        x: bounds.x / img.width,
        y: bounds.y / img.height,
        w: bounds.w / img.width,
        h: bounds.h / img.height
    };
}

// Find the bounding box of non-transparent pixels
function computeOpaqueBounds(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    const alphaThreshold = 10;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4 + 3;
            if (data[idx] > alphaThreshold) {
                found = true;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!found) {
        return { x: 0, y: 0, w: width, h: height };
    }

    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function startGameLoop() {
    if (!_rafId) {
        lastFrameTime = null;
        _rafId = requestAnimationFrame(update);
    }
}

function stopGameLoop() {
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = 0;
    }
}

function drawStaticFrame() {
    if (!context) return;
    context.clearRect(0, 0, boardWidth, boardHeight);
    if (platformImg && platformImg.complete) {
        context.drawImage(platformImg, platform.x, platform.y, platform.width, platform.height);
    }
}

function update(timestamp) {
    _rafId = requestAnimationFrame(update);

    // Check if wallet disconnected during gameplay
    if (gameActive && !canPlayGame()) {
        forceExitToMenu('Session ended');
        return;
    }

    if (lastFrameTime === null) {
        lastFrameTime = timestamp;
    }
    const deltaMs = Math.min(timestamp - lastFrameTime, 100);
    lastFrameTime = timestamp;
    const FRAME_MS = 1000 / 60;
    const dtScale = deltaMs / FRAME_MS;

    const isGameOver = gameState === GAME_STATE.GAME_OVER;
    const shouldUpdate = gameActive && !isPaused && !isGameOver;
    const stepScale = shouldUpdate ? dtScale : 0;

    context.clearRect(0, 0, boardWidth, boardHeight);

    // Draw platform PNG sprite
    if (platformImg && platformImg.complete) {
        context.drawImage(platformImg, platform.x, platform.y, platform.width, platform.height);
    }

    // Debug: visualize groundY line
    if (DEBUG_SHOW_GROUND_LINE) {
        context.save();
        context.strokeStyle = 'red';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, groundY);
        context.lineTo(boardWidth, groundY);
        context.stroke();
        context.restore();
    }

    // Don't draw game elements when overlay is visible (except during game over)
    if (showWelcome && !gameActive && !isGameOver) {
        // Stop the loop — menu is visible, no need to render
        stopGameLoop();
        return;
    }

    // Speed progression
    const displayScore = Math.floor(scoreFloat);
    const speedProgress = Math.min(displayScore / SPEED_MAX_SCORE, 1);
    speed = SPEED_START + (SPEED_MAX - SPEED_START) * speedProgress;
    velocityX = -speed * gameScale;
    const frameVelocityX = velocityX * stepScale;

    //player physics
    const prevY = player.y;
    const prevHeight = player.height;
    const prevGroundY = groundY - prevHeight;
    const wasAirborne = prevY < prevGroundY - 1;
    const onGround = !wasAirborne;
    const canDuck = isDucking && onGround;

    // Only duck on ground (prevents shrink while jumping)
    player.height = canDuck ? playerDuckHeight : playerHeight;
    const playerGroundY = groundY - player.height;

    if (wasAirborne) {
        // In air: keep top position to avoid "extra jump" on duck toggle
        player.y = prevY;
    } else {
        // On ground: keep feet planted
        player.y = playerGroundY;
        if (velocityY > 0) {
            velocityY = 0;
        }
    }

    // Apply gravity and velocity
    velocityY += gravity * stepScale;
    player.y = Math.min(player.y + velocityY * stepScale, playerGroundY);
    if (player.y >= playerGroundY) {
        velocityY = 0;
    }
    player.x = playerX;
    
    // Visual offset to align sprite feet with platform (sprite has transparent bottom padding)
    const visualFootOffset = Math.round(8 * gameScale);
    
    // Draw player with curl down animation for ducking
    let drawX = Math.round(player.x);
    let drawY = Math.round(player.y);
    let drawWidth = player.width;
    let drawHeight = player.height;
    
    // Store physics-based rect for hitbox (NO visual offset)
    playerDrawRectScratch.x = drawX;
    playerDrawRectScratch.y = drawY;
    playerDrawRectScratch.width = drawWidth;
    playerDrawRectScratch.height = drawHeight;
    
    if (canDuck) {
        // Visual ducking: shrink sprite from top, feet stay on ground
        const crouchScale = playerDuckHeight / playerHeight;
        const crouchWidth = Math.round(drawWidth * crouchScale);
        const crouchHeight = drawHeight;
        const crouchX = drawX + (drawWidth - crouchWidth) / 2;
        // Scale the foot offset proportionally so feet don't move
        const duckFootOffset = Math.round(visualFootOffset * crouchScale);
        const crouchY = drawY + duckFootOffset;
        
        // Update scratch for ducking dimensions (hitbox uses this)
        playerDrawRectScratch.x = Math.round(crouchX);
        playerDrawRectScratch.width = Math.round(crouchWidth);
        playerDrawRectScratch.height = Math.round(crouchHeight);
        
        context.drawImage(playerImg, crouchX, crouchY, crouchWidth, crouchHeight);
    } else {
        // Normal standing: draw with visual offset to align feet
        context.drawImage(playerImg, drawX, drawY + visualFootOffset, drawWidth, drawHeight);
    }

    // Prepare player hitbox once per frame
    let playerHitbox = getPlayerHitbox(playerHitboxScratch);

    //token obstacles (ground) - iterate backwards for in-place removal
    for (let i = tokenArray.length - 1; i >= 0; i--) {
        let token = tokenArray[i];
        token.x += frameVelocityX;

        // Remove off-screen tokens
        if (token.x + token.width < 0) {
            tokenArray.splice(i, 1);
            continue;
        }
        
        // Draw token on stick (coin on blue stick)
        drawTokenObstacle(token);

        // Get hitboxes (reuse object)
        let tokenHitbox = getTokenHitbox(token, tokenHitboxScratch);
        
        // Debug: draw hitboxes if enabled
        if (debugHitboxes) {
            // Draw player hitbox in red
            context.strokeStyle = 'red';
            context.lineWidth = 2;
            context.strokeRect(playerHitbox.x, playerHitbox.y, playerHitbox.width, playerHitbox.height);
            
            // Draw token hitbox in blue
            context.strokeStyle = 'blue';
            context.strokeRect(tokenHitbox.x, tokenHitbox.y, tokenHitbox.width, tokenHitbox.height);
        }
        
        if (shouldUpdate && detectCollision(playerHitbox, tokenHitbox)) {
            setGameOverState();
            // Update best score
            if (score > bestScore) {
                bestScore = score;
                localStorage.setItem('baseapp_runner_best_score', String(bestScore));
            }
        }
    }

    //bird obstacles (flying) - iterate backwards for in-place removal
    for (let i = birdArray.length - 1; i >= 0; i--) {
        let bird = birdArray[i];
        bird.x += frameVelocityX;

        // Remove off-screen birds
        if (bird.x + bird.width < 0) {
            birdArray.splice(i, 1);
            continue;
        }
        
        // Draw bird with integer coordinates for crisp rendering
        let drawX = Math.round(bird.x);
        let drawY = Math.round(bird.y);
        context.drawImage(birdImg, drawX, drawY, bird.width, bird.height);

        // Bird hitbox aligned to visible sprite bounds
        birdHitboxScratch.x = Math.round(bird.x);
        birdHitboxScratch.y = Math.round(bird.y);
        birdHitboxScratch.width = bird.width;
        birdHitboxScratch.height = bird.height;
        birdInsetScratch.top = birdInsetScratch.bottom = birdInsetScratch.left = birdInsetScratch.right = hitboxPadding;
        applySpriteBounds(birdHitboxScratch, spriteBounds.bird, birdInsetScratch, birdHitboxScratch);
        
        // Debug: draw bird hitbox if enabled
        if (debugHitboxes) {
            context.strokeStyle = 'green';
            context.lineWidth = 2;
            context.strokeRect(birdHitboxScratch.x, birdHitboxScratch.y, birdHitboxScratch.width, birdHitboxScratch.height);
        }
        
        // Use a head-focused hitbox for birds (prevents passing through head)
        let playerBirdHitbox = getPlayerBirdHitbox(playerBirdHitboxScratch);
        if (shouldUpdate && detectCollision(playerBirdHitbox, birdHitboxScratch)) {
            setGameOverState();
            // Update best score
            if (score > bestScore) {
                bestScore = score;
                localStorage.setItem('baseapp_runner_best_score', String(bestScore));
            }
        }
    }

    if (isGameOver) {
        handleGameOver();
    }

    // Arrays are already cleaned in the loops above

    //score (top right corner)
    const scoreFontSize = Math.round(20 * uiScale);
    const padding = Math.round(scorePadding * uiScale);
    const scoreY = Math.round(scoreTop * uiScale);
    const bestY = scoreY + Math.round(24 * uiScale);
    context.fillStyle="black";
    context.font=`${scoreFontSize}px courier`;
    context.textBaseline = "top";
    // Score increases based on speed
    scoreFloat += stepScale;
    const nextRawScore = Math.floor(scoreFloat);
    if (nextRawScore !== rawScore) {
        rawScore = nextRawScore;
    }
    const nextScore = getAdjustedScore(rawScore);
    if (nextScore !== score) {
        score = nextScore;
    }

    // Add coins at score milestones (every 1000 points)
    if (score >= nextCoinScore) {
        const increments = Math.floor((score - nextCoinScore) / 1000) + 1;
        const coinsPerMilestone = getCoinsPerScoreMilestone();
        addCoins(increments * coinsPerMilestone);
        nextCoinScore += increments * 1000;
        // Start coin popup animation
        coinPopupActive = true;
        coinPopupStartTime = timestamp;
        coinPopupAmount = increments * coinsPerMilestone;
    }
    if (gameUIContainer) {
        updateGameUI();
        // For HTML UI, position popup at estimated location
        coinPopupX = Math.round(padding + 120 * uiScale);
        coinPopupY = Math.round(scoreTop * uiScale);
    } else {
        const coinLabel = "Coin:";
        const coinText = String(coinCount);
        const scoreText = "Score: " + score;
        const bestText = "Best: " + bestScore;
        const scoreX = Math.round(boardWidth - padding - context.measureText(scoreText).width);
        const bestX = Math.round(boardWidth - padding - context.measureText(bestText).width);
        if (isMobileLayout) {
            context.strokeStyle = "white";
            context.lineWidth = 1.5;
            context.strokeText(scoreText, scoreX, scoreY);
            context.strokeText(bestText, bestX, bestY);
        }
        const iconSize = Math.round(18 * uiScale);
        const iconGap = Math.round(6 * uiScale);
        const textGap = Math.round(6 * uiScale);
        const coinX = Math.round(padding);
        const coinY = scoreY;
        context.fillText(coinLabel, coinX, coinY);
        const labelWidth = context.measureText(coinLabel).width;
        const countX = Math.round(coinX + labelWidth + textGap);
        context.fillText(coinText, countX, coinY);
        const iconX = Math.round(countX + context.measureText(coinText).width + iconGap);
        const iconY = Math.round(coinY + Math.floor((scoreFontSize - iconSize) / 2));
        if (ethImg && ethImg.complete) {
            context.drawImage(ethImg, iconX, iconY, iconSize, iconSize);
        }
        // Store position for coin popup (right of icon)
        coinPopupX = iconX + iconSize + Math.round(4 * uiScale);
        coinPopupY = coinY;
        
        context.fillText(scoreText, scoreX, scoreY);
        context.fillText(bestText, bestX, bestY);
    }

    // Draw coin popup animation (+1 that fades out smoothly)
    if (coinPopupActive && timestamp) {
        const elapsed = timestamp - coinPopupStartTime;
        if (elapsed < COIN_POPUP_DURATION) {
            const progress = elapsed / COIN_POPUP_DURATION;
            const easeOut = 1 - Math.pow(1 - progress, 3);

            // Opacity: stay visible for first half, then fade out
            const opacity = progress < 0.4 ? 1 : 1 - ((progress - 0.4) / 0.6);
            // Float upward — no rounding for smooth sub-pixel movement
            const floatOffset = easeOut * 28 * uiScale;
            
            const popupText = "+" + coinPopupAmount;
            // Font size reduced by 30% (24 * 0.7 ≈ 17)
            const popupFontSize = Math.round(17 * uiScale);
            context.font = `bold ${popupFontSize}px courier`;
            
            // Position to the right of coin counter
            const popupX = coinPopupX;
            const popupY = coinPopupY - floatOffset;
            
            // Draw with fading green color
            context.globalAlpha = opacity;
            context.fillStyle = "#00cc00";
            context.strokeStyle = "white";
            context.lineWidth = 1.5;
            context.strokeText(popupText, popupX, popupY);
            context.fillText(popupText, popupX, popupY);
            context.globalAlpha = 1.0;
        } else {
            coinPopupActive = false;
        }
    }

    if (isPaused && !isGameOver) {
        const pauseText = "PAUSE";
        const pauseFont = Math.round(30 * uiScale);
        context.fillStyle = "black";
        context.font = `${pauseFont}px courier`;
        const pauseX = Math.round(boardWidth / 2 - context.measureText(pauseText).width / 2);
        const pauseY = Math.round(boardHeight * 0.4);
        if (isMobileLayout) {
            context.strokeStyle = "white";
            context.lineWidth = 2;
            context.strokeText(pauseText, pauseX, pauseY);
        }
        context.fillText(pauseText, pauseX, pauseY);
    }

    // Game over is now handled by DOM overlay (gameOverOverlay)
    // No canvas drawing needed for game over state
}

function drawTokenObstacle(token) {
    // Draw coins based on token type (1, 2, or 3 coins)
    const stickY = Math.round(groundY - stickHeight);
    
    if (token.type === 1) {
        // Single coin - one stick
        const coinX = Math.round(token.x + (token.width - coinSize) / 2);
        const coinY = Math.round(stickY - coinSize);
        const stickX = Math.round(coinX + (coinSize - stickWidth) / 2);
        
        context.fillStyle = "#0052ff";
        context.fillRect(stickX, stickY, stickWidth, stickHeight);
        drawCoin(coinX, coinY, coinSize);
    } else if (token.type === 2) {
        // Double coins - two sticks (one per coin)
        for (let i = 0; i < 2; i++) {
            const coinX = Math.round(token.x + i * coinSpacing + (token.width - coinSpacing) / 2 - coinSize / 2);
            const coinY = Math.round(stickY - coinSize);
            const stickX = Math.round(coinX + (coinSize - stickWidth) / 2);
            
            context.fillStyle = "#0052ff";
            context.fillRect(stickX, stickY, stickWidth, stickHeight);
            drawCoin(coinX, coinY, coinSize);
        }
    } else if (token.type === 3) {
        // Triple coins - THREE sticks (one per coin)
        for (let i = 0; i < 3; i++) {
            const coinX = Math.round(token.x + i * coinSpacing + (token.width - 2 * coinSpacing) / 2 - coinSize / 2);
            const coinY = Math.round(stickY - coinSize);
            const stickX = Math.round(coinX + (coinSize - stickWidth) / 2);
            
            context.fillStyle = "#0052ff";
            context.fillRect(stickX, stickY, stickWidth, stickHeight);
            drawCoin(coinX, coinY, coinSize);
        }
    }
}

function drawCoin(x, y, size) {
    if (tokenImg.complete) {
        context.drawImage(tokenImg, x, y, size, size);
    } else {
        // Fallback: draw blue circle
        context.fillStyle = "#0052ff";
        context.beginPath();
        context.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
        context.fill();
    }
}

function triggerJump() {
    const playerGroundY = groundY - player.height;
    if (player.y >= playerGroundY - 1) {
        //jump - tuned for reliable obstacle clearing with good airtime
        velocityY = jumpVelocity;
        recordInput("jump");
    }
}

function setDucking(nextState) {
    if (isDucking === nextState) {
        return;
    }
    isDucking = nextState;
    recordInput(nextState ? "duck_down" : "duck_up");
}

function stopDucking() {
    setDucking(false);
}

async function movePlayer(e) {
    if (showWelcome) {
        if (e.code === "Space" || e.code === "Enter") {
            await startGameFromWelcome();
        }
        return;
    }
    if (e.code === "Escape") {
        togglePause();
        return;
    }
    if (isPaused) {
        return;
    }
    if (gameState === GAME_STATE.GAME_OVER) {
        const elapsed = performance.now() - gameOverTimestamp;
        if (elapsed < 300) {
            return;
        }
        if (e.code == "Space") {
            //restart game
            await restartGame();
        }
        return;
    }

    if (e.code == "Space" || e.code == "ArrowUp") {
        triggerJump();
    }
    else if (e.code == "ArrowDown" || e.code == "KeyS") {
        //duck - works both on ground and in air (like Chrome Dino)
        setDucking(true);
    }
}

// Add keyup event listener for ducking
document.addEventListener("keyup", function(e) {
    if (e.code == "ArrowDown" || e.code == "KeyS") {
        stopDucking();
    }
});

async function handleTouchStart(e) {
    if (!isMobileLayout) return;
    
    // Don't block events when Web3Modal is open
    if (document.querySelector('w3m-modal')) {
        return;
    }
    
    if (pauseButton && pauseButton.contains(e.target)) {
        return;
    }
    if (showWelcome) {
        return;
    }
    e.preventDefault();
    const midX = window.innerWidth / 2;

    if (isPaused) {
        return;
    }

    if (gameState === GAME_STATE.GAME_OVER) {
        const elapsed = performance.now() - gameOverTimestamp;
        if (elapsed < 300) {
            return;
        }
        await restartGame();
        return;
    }

    for (const touch of e.changedTouches) {
        if (touch.clientX >= midX) {
            activeRightTouches.add(touch.identifier);
            setDucking(true);
        } else {
            triggerJump();
        }
    }
}

function handleTouchEnd(e) {
    if (!isMobileLayout) return;
    
    // Don't block events when Web3Modal is open
    if (document.querySelector('w3m-modal')) {
        return;
    }
    
    e.preventDefault();

    for (const touch of e.changedTouches) {
        if (activeRightTouches.has(touch.identifier)) {
            activeRightTouches.delete(touch.identifier);
        }
    }

    if (activeRightTouches.size === 0) {
        stopDucking();
    }
}

function placeObstacle() {
    if (gameState === GAME_STATE.GAME_OVER || !gameActive || isPaused) {
        return;
    }

    let placeObstacleChance = getRandom(); //0 - 0.9999...

    if (placeObstacleChance > .55) { //45% chance for token (ground obstacle)
        // Determine token type based on Chrome Dino probabilities
        let tokenTypeChance = getRandom();
        let tokenType, tokenWidth;
        
        if (tokenTypeChance > .90) { // 10% chance for triple
            tokenType = 3;
            tokenWidth = token3Width;
        } else if (tokenTypeChance > .70) { // 20% chance for double
            tokenType = 2;
            tokenWidth = token2Width;
        } else { // 70% chance for single
            tokenType = 1;
            tokenWidth = token1Width;
        }
        
        const safeX = adjustSpawnX(tokenX, SPAWN_X_GAP);
        if (safeX !== null) {
            let token = {
                x : safeX,
                y : tokenY,
                width : tokenWidth,
                height: tokenHeight,
                type: tokenType
            }
            tokenArray.push(token);
        }
    }
    else if (placeObstacleChance > .35) { //20% chance for bird (flying obstacle)
        const headLevelY = getBirdFlyY();
        const safeX = adjustSpawnX(birdX, SPAWN_X_GAP);
        if (safeX !== null) {
            let bird = {
                x : safeX,
                y : headLevelY,
                width : birdWidth,
                height: birdHeight
            }
            birdArray.push(bird);
        }
    }

}

// Apply normalized sprite bounds to a draw rect
function applySpriteBounds(drawRect, bounds, inset, out) {
    if (!bounds) {
        out.x = Math.round(drawRect.x + inset.left);
        out.y = Math.round(drawRect.y + inset.top);
        out.width = Math.round(drawRect.width - inset.left - inset.right);
        out.height = Math.round(drawRect.height - inset.top - inset.bottom);
        return out;
    }

    const bx = drawRect.x + bounds.x * drawRect.width;
    const by = drawRect.y + bounds.y * drawRect.height;
    const bw = bounds.w * drawRect.width;
    const bh = bounds.h * drawRect.height;

    out.x = Math.round(bx + inset.left);
    out.y = Math.round(by + inset.top);
    out.width = Math.round(bw - inset.left - inset.right);
    out.height = Math.round(bh - inset.top - inset.bottom);
    return out;
}

// Get player hitbox (aligned to visible sprite bounds)
function getPlayerHitbox(out) {
    const playerInset = { top: hitboxPadding, bottom: hitboxPadding * 2, left: hitboxPadding, right: hitboxPadding };
    return applySpriteBounds(playerDrawRectScratch, spriteBounds.player, playerInset, out);
}

// Player hitbox for bird collisions (full body)
function getPlayerBirdHitbox(out) {
    getPlayerHitbox(out);
    // Use full body hitbox for bird collisions
    // Small horizontal inset to be forgiving
    const insetX = Math.round(out.width * 0.1);
    out.x = out.x + insetX;
    out.width = Math.max(1, out.width - insetX * 2);
    // Keep full height - bird should collide with entire body
    return out;
}

// Get token hitbox - union of coin(s) and stick(s), aligned to visible pixels
function getTokenHitbox(token, out) {
    const stickY = Math.round(groundY - stickHeight);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const count = token.type;
    for (let i = 0; i < count; i++) {
        const coinX = Math.round(token.x + i * coinSpacing + (token.width - (count - 1) * coinSpacing) / 2 - coinSize / 2);
        const coinY = Math.round(stickY - coinSize);

        // Coin hitbox based on sprite bounds
        coinHitboxScratch.x = coinX;
        coinHitboxScratch.y = coinY;
        coinHitboxScratch.width = coinSize;
        coinHitboxScratch.height = coinSize;
        applySpriteBounds(coinHitboxScratch, spriteBounds.coin, { top: hitboxPadding, bottom: hitboxPadding, left: hitboxPadding, right: hitboxPadding }, coinHitboxScratch);

        // Stick hitbox (rect as drawn)
        const stickX = Math.round(coinX + (coinSize - stickWidth) / 2);
        stickHitboxScratch.x = stickX + hitboxPadding;
        stickHitboxScratch.y = stickY + hitboxPadding;
        stickHitboxScratch.width = Math.max(0, stickWidth - hitboxPadding * 2);
        stickHitboxScratch.height = Math.max(0, stickHeight - hitboxPadding * 2);

        // Union coin + stick
        minX = Math.min(minX, coinHitboxScratch.x, stickHitboxScratch.x);
        minY = Math.min(minY, coinHitboxScratch.y, stickHitboxScratch.y);
        maxX = Math.max(maxX, coinHitboxScratch.x + coinHitboxScratch.width, stickHitboxScratch.x + stickHitboxScratch.width);
        maxY = Math.max(maxY, coinHitboxScratch.y + coinHitboxScratch.height, stickHitboxScratch.y + stickHitboxScratch.height);
    }

    out.x = Math.round(minX);
    out.y = Math.round(minY);
    out.width = Math.round(maxX - minX);
    out.height = Math.round(maxY - minY);
    return out;
}

// Proper AABB collision detection - only returns true on actual overlap
// Requires BOTH X-overlap AND Y-overlap (no early triggers)
function detectCollision(a, b) {
    // Check if rectangles actually overlap (both X and Y must overlap)
    // AABB collision: rectangles intersect if and only if:
    // - a's left edge is to the left of b's right edge AND
    // - a's right edge is to the right of b's left edge AND
    // - a's top edge is above b's bottom edge AND
    // - a's bottom edge is below b's top edge
    const aLeft = a.x;
    const aRight = a.x + a.width;
    const aTop = a.y;
    const aBottom = a.y + a.height;
    
    const bLeft = b.x;
    const bRight = b.x + b.width;
    const bTop = b.y;
    const bBottom = b.y + b.height;
    
    // True overlap requires ALL conditions to be true (BOTH X and Y overlap)
    const xOverlap = aLeft < bRight && aRight > bLeft;
    const yOverlap = aTop < bBottom && aBottom > bTop;
    
    return xOverlap && yOverlap; // Both must be true
}

async function restartGame() {
    // Check wallet is still connected
    if (!canPlayGame()) {
        openWalletMenu();
        return;
    }
    
    // Hide game over overlay
    if (gameOverOverlay) {
        gameOverOverlay.classList.add('hidden');
    }
    
    // Recompute all scaling (ensures identical state on each run)
    applyGameScale();
    lockActiveRunCharacter();
    
    // Reset all game state variables
    gameState = GAME_STATE.RUNNING;
    gameOverTimestamp = 0;
    gameOver = false;
    rawScore = 0;
    score = 0;
    scoreFloat = 0;
    nextCoinScore = 1000;
    if (newRecordEl) newRecordEl.style.display = 'none';
    _prevCoins = _prevScore = _prevBest = -1;
    _prevIsNewRecord = false;
    velocityY = 0;
    isDucking = false;
    isPaused = false;
    lastFrameTime = null;
    // Reset coin popup animation
    coinPopupActive = false;
    coinPopupStartTime = 0;
    coinPopupAmount = 0;
    
    // Reset player position and size (using scaled values)
    player.x = playerX;
    player.y = playerY;
    player.width = playerWidth;
    player.height = playerHeight;
    
    // Clear obstacle arrays
    tokenArray = [];
    birdArray = [];
    
    gameActive = true;
    // Record game start time NOW — before the async session call — so
    // gameElapsedMs in submitBackendRun covers the full actual play time.
    backendSessionStartMs = performance.now();
    if (isPaidGame && pendingPaidTxHash) {
        startPaidBackendSession(pendingPaidTxHash); // fire-and-forget
    } else {
        startBackendSession(); // fire-and-forget, don't block game start
    }
}
