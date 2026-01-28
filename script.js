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
const BASE_BIRD_HEIGHT = 50;
const BASE_BIRD_WIDTH = 50;
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
const BASE_SEPOLIA_CHAIN_ID = "0x14a34"; // 84532
const BASE_SEPOLIA_PARAMS = {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    chainName: "Base Sepolia",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorerUrls: ["https://sepolia.basescan.org"]
};
const CHECKIN_CONTRACT_ADDRESS = "0xc24F4140df57BEadB3F19C9F7bEF0e49E8F47b44";
const NFT_CONTRACT_ADDRESS = ""; // TODO: Set after deployment
const BACKEND_URL = "https://base-runner-k9oj.onrender.com";
const BACKEND_TIMEOUT_MS = 8000;
const ALLOW_GUEST_PLAY = false;

// NFT Contract ABI (minimal for minting)
const NFT_ABI = [
    "function claimFreeCharacter() external returns (uint256)",
    "function mintWithSignature(uint256 characterId, bytes32 nonce, uint256 expiry, bytes signature) external returns (uint256)",
    "function canClaimFree(address user) external view returns (bool)",
    "function hasClaimedFree(address) external view returns (bool)",
    "function balanceOf(address owner) external view returns (uint256)",
    "function getOwnedCharacters(address owner) external view returns (uint256[])"
];

// UI State Machine
const UI_STATE = {
    CONNECT: 'connect',
    MENU: 'menu',
    RUNNING: 'running',
    PAUSED: 'paused'
};
let currentUIState = UI_STATE.CONNECT;

// Overlay elements
let overlayConnect;
let overlayMenu;
let overlayPause;
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
let ethImg;
// Game UI elements
let gameCoinsEl;
let gameScoreEl;
let gameBestEl;
let gameUIContainer;
let gameOverOverlay;
let coinCount = 0;
let nextCoinScore = 10000;
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
let checkinState = {
    lastCheckin: null,
    streak: 0,
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

function getEthereumProvider() {
    if (window.ethereum) {
        return window.ethereum;
    }
    return null;
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

function formatAddress(address) {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isValidAddress(address) {
    return typeof address === "string" && address.startsWith("0x") && address.length === 42;
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

function isToday(dateKey) {
    return !!dateKey && dateKey === getDateKey();
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
        applyProfileData(data);
        return true;
    } catch (err) {
        resetAuthState();
        clearAuthTokenForAddress(walletAddress);
        return false;
    }
}

function buildAuthMessage({ address, nonce, chainId, issuedAt }) {
    return [
        "Base Runner",
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
    setWalletInfo("Подтвердите авторизацию.");
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
            throw new Error("Auth rejected");
        }
        authToken = data.token || "";
        walletAuthenticated = true;
        storeAuthSession(authToken, walletAddress);
        applyProfileData(data);
    } catch (err) {
        console.warn("Auth failed", err);
        walletAuthenticated = false;
        authToken = "";
        clearAuthTokenForAddress(walletAddress);
        setWalletError("Авторизация не удалась. Повторите попытку.");
    } finally {
        authInProgress = false;
        updateWalletUI();
    }
}

async function sendCheckinTransaction() {
    const provider = getEthereumProvider();
    if (!provider || !walletAddress) {
        throw new Error("Wallet not connected");
    }
    if (!isValidAddress(CHECKIN_CONTRACT_ADDRESS)) {
        throw new Error("Checkin contract not set");
    }
    const tx = {
        from: walletAddress,
        to: CHECKIN_CONTRACT_ADDRESS,
        value: "0x0"
    };
    return await provider.request({
        method: "eth_sendTransaction",
        params: [tx]
    });
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
    const payload = {
        sessionId: backendSessionId,
        reportedScore: finalScore,
        inputLog: backendInputLog
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
    const provider = getEthereumProvider();
    const hasProvider = !!provider;
    const isConnected = !!walletAddress;
    const normalizedChainId = normalizeChainId(walletChainId);
    const isOnBaseSepolia = normalizedChainId === BASE_SEPOLIA_CHAIN_ID;
    const walletConnected = isConnected && isOnBaseSepolia;
    walletReady = walletConnected && walletAuthenticated;
    const canPlayNow = walletReady || ALLOW_GUEST_PLAY;

    // Update connect button state and text
    if (connectButton) {
        connectButton.disabled = isDetectingWallet || (!hasProvider) || isConnectingWallet || authInProgress;
        if (isDetectingWallet) {
            setConnectButtonText("Detecting wallet...");
        } else if (!hasProvider) {
            setConnectButtonText("Wallet not found");
        } else if (isConnectingWallet) {
            setConnectButtonText("Connecting...");
        } else if (authInProgress) {
            setConnectButtonText("Signing...");
        } else if (isConnected && !isOnBaseSepolia) {
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
        } else if (!hasProvider) {
            walletStatus.textContent = "Wallet not found. Open in Base App.";
            walletStatus.classList.add("error");
        } else if (!isConnected) {
            walletStatus.textContent = "";
            walletStatus.classList.remove("error");
        } else if (!isOnBaseSepolia) {
            walletStatus.textContent = "Please switch to Base Sepolia network.";
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
    if (currentUIState === UI_STATE.CONNECT || currentUIState === UI_STATE.MENU) {
        currentUIState = canPlayNow ? UI_STATE.MENU : UI_STATE.CONNECT;
        updateUIState();
    }
    
    // Update start button
    if (startButton) {
        startButton.disabled = !canPlayNow;
    }
    
    updateCheckinUI();
}

async function initWalletState() {
    // Wait for provider to be injected (some wallets load asynchronously)
    isDetectingWallet = true;
    updateWalletUI();
    
    const provider = await waitForEthereumProvider(3000);
    isDetectingWallet = false;
    
    if (!provider) {
        updateWalletUI();
        return;
    }

    if (provider.on) {
        provider.on("accountsChanged", handleAccountsChanged);
        provider.on("chainChanged", handleChainChanged);
    }

    try {
        const accounts = await provider.request({ method: "eth_accounts" });
        walletAddress = accounts && accounts.length ? accounts[0] : null;
        const chainId = await provider.request({ method: "eth_chainId" });
        walletChainId = normalizeChainId(chainId) || chainId;
        resetAuthState();
        await restoreAuthSession();
    } catch (err) {
        // ignore
    } finally {
        updateWalletUI();
    }
}

async function connectWallet() {
    const provider = getEthereumProvider();
    if (!provider || isConnectingWallet) {
        setWalletError("Wallet не найден.");
        updateWalletUI();
        return;
    }

    clearWalletMessages();
    isConnectingWallet = true;
    setWalletInfo(walletAddress ? "Открываю переключение сети..." : "Открываю кошелёк...");
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
        if (!normalizedChainId || normalizedChainId !== BASE_SEPOLIA_CHAIN_ID) {
            const switchResult = await trySwitchToBaseSepolia();
            if (!switchResult.ok) {
                if (switchResult.error && switchResult.error.code === 4001) {
                    setWalletError("Отменено в кошельке.");
                } else if (switchResult.error && switchResult.error.code === -32002) {
                    setWalletError("Ожидается подтверждение в кошельке.");
                } else if (switchResult.error && switchResult.error.code === 4200) {
                    setWalletError("Кошелёк не поддерживает переключение сети. Переключите вручную.");
                } else if (switchResult.error && switchResult.error.code === -32601) {
                    setWalletError("Кошелёк не поддерживает переключение сети. Переключите вручную.");
                } else {
                    setWalletError("Не удалось переключить сеть. Попробуйте вручную.");
                }
            } else {
                const nextChainId = await provider.request({ method: "eth_chainId" });
                handleChainChanged(nextChainId);
            }
        }
        const activeChainId = normalizeChainId(walletChainId);
        if (walletAddress && activeChainId === BASE_SEPOLIA_CHAIN_ID && !walletAuthenticated) {
            const restored = await restoreAuthSession();
            if (!restored) {
                authAttempted = false;
                await authenticateWallet();
            }
        }
    } catch (err) {
        if (err && err.code === 4001) {
            setWalletError("Отменено в кошельке.");
        } else if (err && err.code === -32002) {
            setWalletError("Ожидается подтверждение в кошельке.");
        } else if (err && err.code === 4200) {
            setWalletError("Кошелёк не поддерживает переключение сети. Переключите вручную.");
        } else {
            setWalletError("Не удалось подключить кошелёк. Проверьте разрешения.");
        }
    } finally {
        isConnectingWallet = false;
        setWalletInfo("");
        updateWalletUI();
    }
}

async function trySwitchToBaseSepolia() {
    const provider = getEthereumProvider();
    if (!provider || !provider.request) {
        return { ok: false, error: null };
    }
    try {
        await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }]
        });
        return { ok: true };
    } catch (err) {
        if (err && err.code === 4902) {
            await provider.request({
                method: "wallet_addEthereumChain",
                params: [BASE_SEPOLIA_PARAMS]
            });
            return { ok: true };
        } else if (err && err.code === 4001) {
            return { ok: false, error: err };
        } else {
            return { ok: false, error: err };
        }
    }
}

function handleAccountsChanged(accounts) {
    if (accounts && accounts.length) {
        walletAddress = accounts[0];
    } else {
        walletAddress = null;
    }
    resetAuthState();
    checkinState.lastCheckin = null;
    checkinState.streak = 0;
    checkinState.message = "";
    clearWalletMessages();
    openWalletMenu();
    updateWalletUI();
    if (walletAddress) {
        void restoreAuthSession().then(updateWalletUI);
    }
}

function handleChainChanged(chainId) {
    walletChainId = normalizeChainId(chainId) || chainId;
    resetAuthState();
    checkinState.message = "";
    clearWalletMessages();
    openWalletMenu();
    updateWalletUI();
    if (walletAddress) {
        void restoreAuthSession().then(updateWalletUI);
    }
}

function getBirdFlyY() {
    // Bird flies at head level - hits standing player but misses ducking player
    // Bird bottom must be ABOVE ducking player's head for duck to work
    // duckHeight/playerHeight ≈ 0.69, so we need multiplier > 0.69
    const birdBottom = groundY - playerHeight * 0.68; // 75% up from feet
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
    while (!isSpawnXClear(adjusted, minGap) && attempts < 3) {
        adjusted += minGap;
        attempts++;
    }
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

    //load player image (human character)
    playerImg = new Image();
    playerImg.src = "./assets/hum_vit_1.png";
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
    birdImg.src = "./assets/bird.png";
    birdImg.onload = function() {
        spriteBounds.bird = getNormalizedSpriteBounds(birdImg);
    };

    // Load best score from localStorage
    bestScore = parseInt(localStorage.getItem('baseapp_runner_best_score')) || 0;
    coinCount = parseInt(localStorage.getItem(COIN_STORAGE_KEY)) || 0;
    nextCoinScore = 10000;

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

function updateUIState() {
    // Hide all overlays first
    if (overlayConnect) overlayConnect.classList.add("hidden");
    if (overlayMenu) overlayMenu.classList.add("hidden");
    if (overlayPause) overlayPause.classList.add("hidden");
    
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
        case UI_STATE.RUNNING:
            // No overlay visible during gameplay
            break;
    }
    
    // Update pause button visibility
    updatePauseButtonVisibility();
    
    // Update game UI visibility
    updateGameUIVisibility();
    
    // Update wallet address display in menu
    if (walletAddressDisplay && walletAddress) {
        walletAddressDisplay.textContent = formatAddress(walletAddress);
    }
    
    // Update start button state
    if (startButton) {
        startButton.disabled = !canPlayGame();
    }
    
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
    // Update HTML UI elements with current game values
    if (gameCoinsEl) {
        gameCoinsEl.textContent = String(coinCount);
    }
    if (gameScoreEl) {
        gameScoreEl.textContent = String(score);
    }
    if (gameBestEl) {
        gameBestEl.textContent = String(bestScore);
    }
}

function updateMenuState() {
    // Legacy function - most logic moved to updateUIState
    if (startButton) {
        startButton.disabled = !canPlayGame();
    }
    updateCheckinUI();
}

function applyProfileData(data) {
    if (!data) return;
    // Use MAX of local and backend values to not lose progress
    if (Number.isFinite(data.coinBalance)) {
        const localCoins = parseInt(localStorage.getItem(COIN_STORAGE_KEY)) || 0;
        coinCount = Math.max(localCoins, data.coinBalance);
        saveCoins();
    }
    if (Number.isFinite(data.bestScore)) {
        const localBest = parseInt(localStorage.getItem('baseapp_runner_best_score')) || 0;
        bestScore = Math.max(localBest, data.bestScore);
        localStorage.setItem("baseapp_runner_best_score", String(bestScore));
    }
    checkinState.lastCheckin = data.lastCheckin || null;
    checkinState.streak = Number.isFinite(data.streak) ? data.streak : 0;
    checkinState.message = "";
    updateCheckinUI();
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
        el.textContent = text;
        if (isSuccess !== undefined) {
            el.classList.toggle("success", isSuccess);
        }
    };
    updateStatus(checkinStatus);
    updateStatus(checkinStatusPause);
}

function updateCheckinUI() {
    if (!checkinButton && !checkinButtonPause) return;
    
    if (!walletReady) {
        setCheckinButtonDisabled(true);
        setCheckinButtonText("Check-in");
        setCheckinStatusText("", false);
        return;
    }
    if (!isValidAddress(CHECKIN_CONTRACT_ADDRESS)) {
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
    const checkedIn = isToday(checkinState.lastCheckin);
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
    checkinState.message = "";
    checkinState.loading = true;
    updateCheckinUI();
    try {
        const startResponse = await fetch(`${BACKEND_URL}/api/checkin/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({})
        });
        if (!startResponse.ok) {
            throw new Error(`Check-in start failed: ${startResponse.status}`);
        }
        const startData = await startResponse.json();
        if (startData.alreadyCheckedIn) {
            checkinState.lastCheckin = startData.lastCheckin || checkinState.lastCheckin;
            checkinState.streak = Number.isFinite(startData.streak) ? startData.streak : checkinState.streak;
            if (Number.isFinite(startData.coinBalance)) {
                coinCount = startData.coinBalance;
                saveCoins();
            }
            return;
        }
        const message = startData.message;
        if (!message) {
            throw new Error("Check-in message missing");
        }
        setCheckinStatusText("Подтвердите транзакцию check-in.", false);
        const txHash = await sendCheckinTransaction();
        // Send txHash instead of signature - transaction is proof of checkin
        const submitResponse = await fetch(`${BACKEND_URL}/api/checkin/submit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({
                txHash
            })
        });
        if (!submitResponse.ok) {
            throw new Error(`Check-in submit failed: ${submitResponse.status}`);
        }
        const submitData = await submitResponse.json();
        if (submitData && submitData.ok) {
            checkinState.lastCheckin = submitData.lastCheckin || checkinState.lastCheckin;
            checkinState.streak = Number.isFinite(submitData.streak) ? submitData.streak : checkinState.streak;
            if (Number.isFinite(submitData.coinBalance)) {
                coinCount = submitData.coinBalance;
                saveCoins();
            }
            const shortHash = txHash ? `${txHash.slice(0, 8)}...${txHash.slice(-6)}` : "";
            const rewardText = submitData.bonusAwarded
                ? `+${submitData.coinsAwarded} coins (bonus за стрик!)`
                : `+${submitData.coinsAwarded} coin`;
            checkinState.message = shortHash
                ? `${rewardText}. Tx: ${shortHash}`
                : rewardText;
        }
    } catch (err) {
        console.warn("Check-in failed", err);
        checkinState.message = "Check-in не удался. Попробуйте ещё раз.";
    } finally {
        checkinState.loading = false;
        updateCheckinUI();
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
        const canClaim = await contract.canClaimFree(walletAddress);
        if (!canClaim) {
            return { ok: false, error: "Already claimed or not available" };
        }
        
        // Send transaction
        const tx = await contract.claimFreeCharacter();
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

// Purchase character with coins
async function purchaseCharacter(characterId) {
    if (!walletReady || !NFT_CONTRACT_ADDRESS || !authToken) {
        return { ok: false, error: "Wallet not ready" };
    }
    
    shopState.loading = true;
    
    try {
        // Step 1: Start purchase on backend (reserve coins, get signature)
        const startResponse = await fetch(`${BACKEND_URL}/api/shop/purchase/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ characterId })
        });
        
        const startData = await startResponse.json();
        if (!startData.ok) {
            return { ok: false, error: startData.error };
        }
        
        shopState.pendingPurchase = startData;
        
        // Step 2: Send mint transaction
        const provider = getEthereumProvider();
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, signer);
        
        let txHash = null;
        try {
            const tx = await contract.mintWithSignature(
                characterId,
                startData.nonce,
                startData.expiry,
                startData.signature
            );
            const receipt = await tx.wait();
            txHash = receipt.hash;
        } catch (txErr) {
            // Transaction failed or was cancelled - cancel purchase
            await cancelPurchase(startData.nonce);
            return { ok: false, error: "Transaction cancelled or failed" };
        }
        
        // Step 3: Confirm purchase on backend
        const confirmResponse = await fetch(`${BACKEND_URL}/api/shop/purchase/confirm`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ nonce: startData.nonce, txHash })
        });
        
        const confirmData = await confirmResponse.json();
        if (!confirmData.ok) {
            console.warn("Purchase confirm failed but tx succeeded", confirmData);
        }
        
        shopState.pendingPurchase = null;
        await loadUserInventory();
        
        return { ok: true, txHash, coinsDeducted: confirmData.coinsDeducted };
    } catch (err) {
        console.warn("Purchase failed", err);
        // Try to cancel if we have a pending purchase
        if (shopState.pendingPurchase) {
            await cancelPurchase(shopState.pendingPurchase.nonce);
        }
        return { ok: false, error: err.message || "Purchase failed" };
    } finally {
        shopState.loading = false;
        shopState.pendingPurchase = null;
    }
}

// Cancel pending purchase
async function cancelPurchase(nonce) {
    try {
        await fetch(`${BACKEND_URL}/api/shop/purchase/cancel`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ nonce })
        });
    } catch (err) {
        console.warn("Cancel purchase failed", err);
    }
}

// Check if user needs to claim free character before playing
function needsFreeClaim() {
    return walletReady && 
           NFT_CONTRACT_ADDRESS && 
           !shopState.hasClaimedFree && 
           shopState.characters.length > 0;
}

async function startGameFromWelcome() {
    if (!canPlayGame()) {
        updateWalletUI();
        return;
    }
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

    //score (правый верхний угол)
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

    // Add coins at score milestones (every 10000 points)
    if (score >= nextCoinScore) {
        const increments = Math.floor((score - nextCoinScore) / 10000) + 1;
        addCoins(increments);
        nextCoinScore += increments * 10000;
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
            // Smooth easeOut progress (starts fast, slows down)
            const progress = elapsed / COIN_POPUP_DURATION;
            const easeOut = 1 - Math.pow(1 - progress, 3); // cubic ease out
            
            // Opacity fades smoothly
            const opacity = 1 - easeOut;
            // Float upward slowly as it fades
            const floatOffset = Math.round(easeOut * 20 * uiScale);
            
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
        
        let token = {
            x : adjustSpawnX(tokenX, SPAWN_X_GAP),
            y : tokenY,
            width : tokenWidth,
            height: tokenHeight,
            type: tokenType
        }
        tokenArray.push(token);
    }
    else if (placeObstacleChance > .35) { //20% chance for bird (flying obstacle)
        // Set bird at head level (can be ducked under)
        const headLevelY = getBirdFlyY();
        let bird = {
            x : adjustSpawnX(birdX, SPAWN_X_GAP),
            y : headLevelY,
            width : birdWidth,
            height: birdHeight
        }
        birdArray.push(bird);
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

// Player hitbox for bird collisions (focuses on head/upper body)
function getPlayerBirdHitbox(out) {
    getPlayerHitbox(out);
    // Focus on upper body/head for bird collisions
    // When ducking, this hitbox is naturally smaller due to playerDrawRectScratch
    const headHeight = Math.max(1, Math.round(out.height * 0.55));
    const insetX = Math.round(out.width * 0.1);
    out.x = out.x + insetX;
    out.width = Math.max(1, out.width - insetX * 2);
    out.height = headHeight;
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
    nextCoinScore = 10000;
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