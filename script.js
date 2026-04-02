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

const BACKEND_URL = "https://base-runner-k9oj.onrender.com";
const BACKEND_TIMEOUT_MS = 8000;
const ALLOW_GUEST_PLAY = false;

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
let collectionOpenedFrom = null; // Track where collection was opened from ('menu' or 'pause')

// Overlay elements
let overlayConnect;
let overlayMenu;
let overlayPause;
let overlayCollection;
let pauseButton;
let connectButton;
let walletStatus;
let walletAddressDisplay;
let startButton;
let resumeButton;
let checkinButton;
let checkinStatus;
let checkinButtonPause;
let checkinStatusPause;
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
let backendSessionId = null;
let backendSeed = null;
let backendInputLog = [];
let backendSessionStartMs = 0;
let backendSessionActive = false;
let backendRunSubmitted = false;
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
    // Check user agent
    if (ua.includes('coinbase') || ua.includes('metamask') || ua.includes('trust') || ua.includes('rainbow')) {
        return true;
    }
    // Check provider flags
    if (window.ethereum) {
        return window.ethereum.isCoinbaseWallet || 
               window.ethereum.isCoinbaseBrowser ||
               window.ethereum.isMetaMask ||
               window.ethereum.isTrust ||
               window.ethereum.isWalletBrowser;
    }
    return false;
}

// Check if mobile device
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getEthereumProvider() {
    // Return Web3Modal provider if connected via WalletConnect
    if (activeWalletType === 'walletconnect' && window.web3modalProvider) {
        return window.web3modalProvider;
    }
    // Return injected provider (MetaMask, Coinbase, Trust, etc.)
    return window.ethereum || null;
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
        console.log('Web3Modal loaded successfully');
        
        // Setup provider listener - only react to actual connections/disconnections
        let wasConnectedViaModal = false;
        modal.subscribeProvider(async (state) => {
            console.log('Web3Modal state:', state);
            if (state.isConnected && state.address) {
                console.log('Web3Modal connected:', state.address);
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
                const restored = await restoreAuthSession();
                if (!restored) {
                    await authenticateWallet();
                }
                updateWalletUI();
            } else if (!state.isConnected && wasConnectedViaModal && activeWalletType === 'walletconnect') {
                // Only disconnect if user was actually connected via this modal
                console.log('Web3Modal disconnected');
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

// Show wallet selection modal
function showWalletSelector() {
    // Remove existing modal if any
    const existingModal = document.getElementById('wallet-modal');
    if (existingModal) existingModal.remove();
    
    // Check what wallets are available
    const hasInjected = !!window.ethereum;
    const mobile = isMobile();
    
    // If we have an injected provider (PC with extension or inside wallet app), connect directly
    if (hasInjected) {
        connectWithInjected();
        return;
    }
    
    // No wallet - show options
    const modal = document.createElement('div');
    modal.id = 'wallet-modal';
    

    
    modal.innerHTML = `
        <div class="wallet-modal-backdrop"></div>
        <div class="wallet-modal-content">
            <h3>Connect Wallet</h3>
            <div class="wallet-options">
                ${mobile ? `
                <button type="button" class="wallet-option" id="btn-coinbase">
                    <img src="https://avatars.githubusercontent.com/u/18060234?s=200&v=4" alt="Coinbase" width="32" height="32">
                    <span>Coinbase Wallet</span>
                </button>
                <button type="button" class="wallet-option" id="btn-other">
                    <img src="https://avatars.githubusercontent.com/u/37784886?s=200&v=4" alt="WalletConnect" width="32" height="32">
                    <span>Other Wallets</span>
                </button>
                ` : `
                <button type="button" class="wallet-option" id="btn-install-coinbase">
                    <img src="https://avatars.githubusercontent.com/u/18060234?s=200&v=4" alt="Coinbase" width="32" height="32">
                    <span>Install Coinbase Wallet</span>
                </button>
                <button type="button" class="wallet-option" id="btn-install-metamask">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="MetaMask" width="32" height="32">
                    <span>Install MetaMask</span>
                </button>
                `}
            </div>
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
    
    // Handle wallet buttons with both click and touch
    const coinbaseBtn = modal.querySelector('#btn-coinbase');
    const otherBtn = modal.querySelector('#btn-other');
    const installCoinbaseBtn = modal.querySelector('#btn-install-coinbase');
    const installMetamaskBtn = modal.querySelector('#btn-install-metamask');
    
    const handleCoinbase = (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.remove();
        const link = `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(APP_URL)}`;
        window.location.href = link;
    };
    
    const handleOtherWallets = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Show loading state
        if (otherBtn) {
            otherBtn.innerHTML = '<span>Loading...</span>';
            otherBtn.disabled = true;
        }
        
        try {
            // Load Web3Modal on demand
            const web3modal = await initWeb3Modal();
            modal.remove();
            
            if (web3modal) {
                await web3modal.open();
                return;
            }
        } catch (err) {
            console.error('Web3Modal error:', err);
        }
        
        modal.remove();
        // Fallback - open MetaMask deeplink
        const link = `https://metamask.app.link/dapp/${APP_URL.replace('https://', '')}`;
        window.location.href = link;
    };
    
    const handleInstallCoinbase = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open('https://www.coinbase.com/wallet', '_blank');
    };
    
    const handleInstallMetamask = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open('https://metamask.io/download/', '_blank');
    };
    
    if (coinbaseBtn) {
        coinbaseBtn.addEventListener('click', handleCoinbase);
        coinbaseBtn.addEventListener('touchend', handleCoinbase);
    }
    
    if (otherBtn) {
        otherBtn.addEventListener('click', handleOtherWallets);
        otherBtn.addEventListener('touchend', handleOtherWallets);
    }
    
    if (installCoinbaseBtn) {
        installCoinbaseBtn.addEventListener('click', handleInstallCoinbase);
        installCoinbaseBtn.addEventListener('touchend', handleInstallCoinbase);
    }
    
    if (installMetamaskBtn) {
        installMetamaskBtn.addEventListener('click', handleInstallMetamask);
        installMetamaskBtn.addEventListener('touchend', handleInstallMetamask);
    }
}

// Connect with injected wallet (MetaMask, etc.)
async function connectWithInjected() {
    const provider = window.ethereum;
    if (!provider) {
        setWalletError("No browser wallet found");
        return;
    }
    
    try {
        activeWalletType = 'injected';
        isConnectingWallet = true;
        updateWalletUI();
        
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        handleAccountsChanged(accounts);
        
        // Switch to Base
        await switchToBase();
        
        isConnectingWallet = false;
        updateWalletUI();
        
        console.log("Connected with browser wallet");
    } catch (err) {
        console.error("Injected wallet connect error:", err);
        setWalletError(err.message || "Connection failed");
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
        console.log('resolveBasename:', address);
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
        console.log('reverseNode:', reverseNode);
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
        console.log('nameResult:', nameJson.result?.slice(0, 80));
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
        console.warn("Auth failed", err);
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

    const tx = await contract.checkIn();
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
    rng = null;
}

function recordInput(type) {
    if (!backendSessionActive || gameState === GAME_STATE.GAME_OVER || showWelcome || isPaused) {
        return;
    }
    const elapsed = Math.round(performance.now() - backendSessionStartMs);
    backendInputLog.push({ t: elapsed, type });
}

async function startBackendSession() {
    resetBackendSession();
    if (!BACKEND_URL || !authToken) {
        return false;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    try {
        const response = await fetch(`${BACKEND_URL}/api/session/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Backend start failed: ${response.status}`);
        }
        const data = await response.json();
        backendSessionId = data.sessionId || null;
        backendSeed = data.seed || null;
        backendSessionStartMs = performance.now();
        backendInputLog = [];
        backendSessionActive = !!backendSessionId;
        rng = backendSeed ? createRng(backendSeed) : null;
        return backendSessionActive;
    } catch (err) {
        console.warn("Backend session start failed", err);
        resetBackendSession();
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function submitBackendRun(finalScore) {
    if (!backendSessionActive || backendRunSubmitted || !BACKEND_URL) {
        return;
    }
    backendRunSubmitted = true;
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
            throw new Error(`Backend submit failed: ${response.status}`);
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
        console.warn("Backend submit failed", err);
    } finally {
        clearTimeout(timeoutId);
    }
}

function handleGameOver() {
    if (backendSessionActive && !backendRunSubmitted) {
        submitBackendRun(score);
    }
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
    
    updateCheckinUI();
}

async function disconnectWallet() {
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
    resetAuthState();
    clearWalletMessages();
    updateWalletUI();
}

async function initWalletState() {
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
        console.log("Wallet event listeners registered");
    }
    
    // Auto-connect if inside wallet browser (Coinbase Wallet, MetaMask app, etc.)
    if (isWalletBrowser() || isMobile()) {
        console.log("Wallet browser detected, auto-connecting...");
        walletInitializing = true;
        try {
            const accounts = await provider.request({ method: "eth_accounts" });
            if (accounts && accounts.length > 0) {
                // Already connected, just use existing connection
                walletAddress = accounts[0];
                activeWalletType = 'injected';
                const chainId = await provider.request({ method: "eth_chainId" });
                walletChainId = normalizeChainId(chainId) || chainId;

                // Only switch if not already on Base
                if (walletChainId !== BASE_CHAIN_ID) {
                    await switchToBase();
                    const newChainId = await provider.request({ method: "eth_chainId" });
                    walletChainId = normalizeChainId(newChainId) || newChainId;
                }

                walletInitializing = false;

                // Try to restore existing session first
                const restored = await restoreAuthSession();
                if (!restored) {
                    // Only request new signature if no valid session
                    await authenticateWallet();
                }
                resolveBasename(walletAddress);
                updateWalletUI();
                return;
            } else {
                // Not connected yet, request connection
                activeWalletType = 'injected';
                isConnectingWallet = true;
                updateWalletUI();
                const newAccounts = await provider.request({ method: "eth_requestAccounts" });
                walletAddress = newAccounts[0];
                const chainId = await provider.request({ method: "eth_chainId" });
                walletChainId = normalizeChainId(chainId) || chainId;

                // Only switch if not already on Base
                if (walletChainId !== BASE_CHAIN_ID) {
                    await switchToBase();
                    const newChainId = await provider.request({ method: "eth_chainId" });
                    walletChainId = normalizeChainId(newChainId) || newChainId;
                }

                walletInitializing = false;

                // Try to restore existing session first
                const restored = await restoreAuthSession();
                if (!restored) {
                    await authenticateWallet();
                }
                resolveBasename(walletAddress);
                isConnectingWallet = false;
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

    // Event listeners already set up above

    try {
        if (provider) {
            const accounts = await provider.request({ method: "eth_accounts" });
            if (accounts && accounts.length) {
                walletAddress = accounts[0];
                activeWalletType = 'injected';
            }
            const chainId = await provider.request({ method: "eth_chainId" });
            walletChainId = normalizeChainId(chainId) || chainId;
        }
        resetAuthState();
        await restoreAuthSession();
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
    
    // Show wallet selector (Coinbase recommended)
    if (isConnectingWallet) return;
    showWalletSelector();
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
    walletStatus = document.getElementById("wallet-status");
    walletAddressDisplay = document.getElementById("wallet-address");
    startButton = document.getElementById("start-button");
    resumeButton = document.getElementById("resume-button");
    checkinButton = document.getElementById("checkin-button");
    checkinStatus = document.getElementById("checkin-status");
    checkinButtonPause = document.getElementById("checkin-button-pause");
    checkinStatusPause = document.getElementById("checkin-status-pause");

    // Disconnect buttons
    const disconnectBtn = document.getElementById("disconnect-button");
    const disconnectBtnPause = document.getElementById("disconnect-button-pause");
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
    if (resumeButton) {
        resumeButton.addEventListener("click", resumeGame);
        resumeButton.addEventListener("touchstart", function(e) {
            e.stopPropagation();
            e.preventDefault();
            resumeGame();
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
    initWalletState();
    
    context = board.getContext("2d");

    // Setup crisp rendering
    setupCrispCanvas();
    window.addEventListener("resize", setupCrispCanvas);
    
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

    requestAnimationFrame(update);
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

function updateGameUI() {
    if (gameCoinsEl) gameCoinsEl.textContent = String(coinCount);
    if (gameScoreEl) gameScoreEl.textContent = String(score);

    const isNewRecord = score > 0 && score >= bestScore;
    if (gameBestEl)  gameBestEl.textContent = isNewRecord ? String(score) : String(bestScore);

    const newRecordEl = document.getElementById('new-record-label');
    if (newRecordEl) newRecordEl.style.display = isNewRecord ? '' : 'none';
}

function updateMenuState() {
    // Legacy function - most logic moved to updateUIState
    if (startButton) {
        startButton.disabled = !canPlayGame();
    }
    updateCheckinUI();
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
    if (Number.isFinite(data.selectedCharacter)) {
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
        const tx = await contract.mintFreeCharacter();
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
    const response = await fetch(`${BACKEND_URL}/api/shop/purchase/start`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ characterId: charId })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Failed to start purchase');
    return data; // { nonce, expiry, signature, price }
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

// ============ Collection Functions ============

async function checkCollectionStatus() {
    // Data is now loaded from backend in applyProfileData
    // This function just updates the UI
    console.log('Collection status:', { hasFreeMint, ownedCharacters, selectedCharacter });
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
        if (isOwned) {
            card.classList.add('owned');
            card.classList.remove('locked');
            
            if (selectedCharacter === charId) {
                card.classList.add('selected');
                btn.textContent = 'Selected ✓';
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
    startButton.textContent = 'Start Game';

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
        const tx = await contract.mintFreeCharacter();
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
        if (data.selectedCharacter !== undefined) {
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
            console.log(`Loaded sprite for newly purchased character ${charId}`);
        }
    } catch (e) {
        console.warn(`Failed to load sprite ${charId}:`, e);
    }
}

// Handle character button click - select if owned, purchase if not
async function handleCharacterAction(charId) {
    console.log('handleCharacterAction called:', charId);
    const char = CHARACTERS[charId];
    if (!char) {
        console.warn('Character not found:', charId);
        return;
    }
    
    const isOwned = ownedCharacters.includes(charId) || (charId === 0 && hasFreeMint);
    console.log('Character action:', { charId, isOwned, hasFreeMint, ownedCharacters });
    
    if (isOwned) {
        // Already owned - select it
        console.log('Selecting character:', charId);
        await selectCharacter(charId);
    } else if (charId === 0) {
        // Free mint
        console.log('Starting free mint for Vitalik');
        await handleFreeMint();
    } else {
        // Purchase
        console.log('Starting purchase for:', charId);
        await handlePurchase(charId);
    }
}

// Handle free mint (character 0 - Vitalik)
async function handleFreeMint() {
    console.log('handleFreeMint called, hasFreeMint:', hasFreeMint);
    if (hasFreeMint) {
        console.log('Already has free mint, skipping');
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
            console.log('NFT contract not configured, using backend-only mint');
            // Fallback to backend-only mint
            await backendOnlyFreeMint();
            return;
        }
        
        // Blockchain mint
        console.log('Starting blockchain free mint...');
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);
        
        // Check if can claim
        console.log('Checking if can claim free mint...');
        const canClaim = await contract.canClaimFreeMint(walletAddress);
        if (!canClaim) {
            alert('Already claimed or not available on-chain');
            collectionLoading = false;
            updateCollectionUI();
            return;
        }
        
        // Send transaction
        console.log('Sending mint transaction...');
        if (btn) btn.textContent = 'Confirm in wallet...';
        const tx = await contract.mintFreeCharacter();
        
        console.log('Waiting for confirmation...', tx.hash);
        if (btn) btn.textContent = 'Confirming...';
        const receipt = await tx.wait();
        console.log('Transaction confirmed:', receipt.hash);
        
        // Record on backend
        await recordFreeMintOnBackend(receipt.hash);
        
    } catch (e) {
        console.error('Free mint failed:', e);
        if (e.code === 4001 || e.code === 'ACTION_REJECTED') {
            alert('Transaction cancelled');
        } else if (e.message?.includes('canClaimFreeMint')) {
            // Contract method doesn't exist, fallback to backend
            console.log('Contract method not found, using backend-only mint');
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
        console.log('Calling backend claim-free...');
        const response = await fetch(`${BACKEND_URL}/api/shop/claim-free`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ characterId: 0 })
        });
        
        const data = await response.json();
        console.log('Backend response:', data);
        
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
            console.log('Free mint successful (backend only)!');
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
        console.log('Backend recorded mint:', data);
        
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
    console.log('Free mint successful!');
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
        if (btn) btn.textContent = 'Confirm tx...';
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);

        const tx = await nftContract.mintWithSignature(
            charId,
            voucher.nonce,
            voucher.expiry,
            voucher.signature
        );

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
        selectedCharacter = charId;
        localStorage.setItem('selectedCharacter', String(charId));

        await loadSpriteForCharacter(charId);
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
    
    console.log('Selected character:', char.name);
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
    
    // Load real sprites from backend ONCE (skips if already loaded)
    await loadOwnedSprites();
    
    // Update sprite from cache
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
    
    // Ensure player sprite is set
    if (!spriteCache[selectedCharacter]) {
        console.log('Sprite not cached, loading...');
        await loadOwnedSprites(true); // Force reload
    }
    updatePlayerSprite();
    
    // Transition to running state
    currentUIState = UI_STATE.RUNNING;
    showWelcome = false;
    gameActive = false;
    isPaused = false;
    updateUIState();
    await restartGame();
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
    resetBackendSession();
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
    const ctx = canvas.getContext("2d");
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

function update(timestamp) {
    requestAnimationFrame(update);
    
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
        const birdInset = { top: hitboxPadding, bottom: hitboxPadding, left: hitboxPadding, right: hitboxPadding };
        applySpriteBounds(birdHitboxScratch, spriteBounds.bird, birdInset, birdHitboxScratch);
        
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
    const nextScore = Math.floor(scoreFloat);
    if (nextScore !== score) {
        score = nextScore;
    }

    // Add coins at score milestones (every 1000 points)
    if (score >= nextCoinScore) {
        const increments = Math.floor((score - nextCoinScore) / 1000) + 1;
        addCoins(increments);
        nextCoinScore += increments * 1000;
        // Start coin popup animation
        coinPopupActive = true;
        coinPopupStartTime = timestamp;
        coinPopupAmount = increments;
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
    
    // Reset all game state variables
    gameState = GAME_STATE.RUNNING;
    gameOverTimestamp = 0;
    gameOver = false;
    score = 0;
    scoreFloat = 0;
    nextCoinScore = 1000;
    const nrl = document.getElementById('new-record-label');
    if (nrl) nrl.style.display = 'none';
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
    
    gameActive = false;
    await startBackendSession();
    gameActive = true;
}