//board - scaled up by 1.5x
let board;
const BASE_BOARD_WIDTH = 1125; // 750 * 1.5
const BASE_BOARD_HEIGHT = 450; // 250 * 1.5
// Platform drawn on canvas - defines the ground level
const PLATFORM_HEIGHT = 45; // Height of platform bar on canvas
const PLATFORM_MARGIN_PERCENT = 0.12; // 12% margin on each side
const PLATFORM_BOTTOM_MARGIN = 20; // Pixels from canvas bottom to platform bottom
const MOBILE_MAX_WIDTH = 900;
const MOBILE_MIN_BOARD_WIDTH = 480;
const MOBILE_WIDTH_MULTIPLIER = 1.25;
const MOBILE_OBJECT_SCALE = 0.9;
const MOBILE_BASE_WIDTH = 390;
const MOBILE_SCALE_MIN = 0.95;
const MOBILE_SCALE_MAX = 1.05;
const MOBILE_PLAYER_X = 35;
const MOBILE_PLAYER_EDGE_GAP = 2;
const MOBILE_UI_SCALE = 0.95;
const MOBILE_SCORE_PADDING = 8;
const MOBILE_SCORE_TOP = 8;
const MOBILE_GAME_OVER_Y_RATIO = 0.35;
const MOBILE_RESTART_GAP = 24;
const BASE_SPAWN_OFFSET = 200;
let boardWidth = BASE_BOARD_WIDTH;
let boardHeight = BASE_BOARD_HEIGHT;
let groundY = BASE_BOARD_HEIGHT - PLATFORM_BOTTOM_MARGIN - PLATFORM_HEIGHT;
let context;
let renderScale = 1;
let isMobileLayout = false;
let objectScale = 1;
let uiScale = 1;
let scorePadding = 10;
let scoreTop = 10;
let gameOverYRatio = 0.5;
let restartGap = 30;
let activeRightTouches = new Set();
const FRAME_MS = 1000 / 60;
let lastFrameTime = null;
let mobileEdgeGapWorld = 0;
let mobileSafeLeftWorld = 0;
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
const BACKEND_URL = "https://base-runner-k9oj.onrender.com";
const BACKEND_TIMEOUT_MS = 8000;

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
let ethImg;
// Game UI elements
let gameCoinsEl;
let gameScoreEl;
let gameBestEl;
let gameUIContainer;
let coinCount = 0;
let nextCoinScore = 10000;
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
    if (!backendSessionActive || gameOver || showWelcome || isPaused) {
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
        if (walletReady) {
            currentUIState = UI_STATE.MENU;
        } else {
            currentUIState = UI_STATE.CONNECT;
        }
        updateUIState();
    }
    
    // Update start button
    if (startButton) {
        startButton.disabled = !walletReady;
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
    // Bird should fly at head level when standing
    return Math.round(playerY - birdHeight);
}

//player (human character) - scaled up by 1.5x, then widened by 15%, then +10% more
const BASE_PLAYER_WIDTH = 250; // 152 * 1.1 (increased by 10% more)
const BASE_PLAYER_HEIGHT = 180; // 94 * 1.5
const BASE_PLAYER_DUCK_HEIGHT = 60; // For ducking (crouched pose, head visible)
const BASE_PLAYER_X = 75; // 50 * 1.5
let playerWidth = BASE_PLAYER_WIDTH;
let playerHeight = BASE_PLAYER_HEIGHT;
let playerDuckHeight = BASE_PLAYER_DUCK_HEIGHT;
let playerX = BASE_PLAYER_X;
let playerSpriteInsetX = 0;
let playerY = groundY - playerHeight;
let playerImg;
let isDucking = false;

// Debug mode flag (set to true to visualize hitboxes)
let debugHitboxes = false;

// Render/physics constants - scaled to match smaller sprites
const BASE_COIN_SIZE = 48;
const BASE_STICK_HEIGHT = 20;
const BASE_STICK_WIDTH = 3;
const BASE_COIN_SPACING = 56;
const SPAWN_X_GAP = 400; // minimum horizontal gap between obstacles
let COIN_SIZE = BASE_COIN_SIZE;
let STICK_HEIGHT = BASE_STICK_HEIGHT;
let STICK_WIDTH = BASE_STICK_WIDTH;
let COIN_SPACING = BASE_COIN_SPACING;

// Reusable hitbox scratch objects to reduce GC
const playerHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const tokenHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const birdHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const playerBirdHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const coinHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const stickHitboxScratch = { x: 0, y: 0, width: 0, height: 0 };
const playerDrawRectScratch = { x: 0, y: 0, width: 0, height: 0 };

// Small insets for fair but tight collisions
const PLAYER_HITBOX_INSET = { top: 1, bottom: 2, left: 1, right: 1 };
const OBSTACLE_HITBOX_INSET = { top: 1, bottom: 1, left: 1, right: 1 };

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

let player = {
    x : playerX,
    y : playerY,
    width : playerWidth,
    height : playerHeight
}

//obstacles arrays
let tokenArray = [];
let birdArray = [];

//token obstacle variants (ground obstacle - coin on stick)
const BASE_TOKEN1_WIDTH = BASE_COIN_SIZE;
const BASE_TOKEN2_WIDTH = BASE_COIN_SPACING + BASE_COIN_SIZE;
const BASE_TOKEN3_WIDTH = BASE_COIN_SPACING * 2 + BASE_COIN_SIZE;
const BASE_TOKEN_HEIGHT = BASE_STICK_HEIGHT + BASE_COIN_SIZE;
let token1Width = BASE_TOKEN1_WIDTH;
let token2Width = BASE_TOKEN2_WIDTH;
let token3Width = BASE_TOKEN3_WIDTH;
let tokenHeight = BASE_TOKEN_HEIGHT;
let tokenX = boardWidth + BASE_SPAWN_OFFSET;
let tokenY = groundY - tokenHeight;
let tokenImg;

//bird obstacle (flying enemy) - scaled up by 1.5x, then +10%
const BASE_BIRD_WIDTH = 100; // 69 * 1.1 (increased by 10%)
const BASE_BIRD_HEIGHT = 100; // 60 * 1.1 (increased by 10%)
const BASE_BIRD_Y_OFFSET = 150;
let birdWidth = BASE_BIRD_WIDTH;
let birdHeight = BASE_BIRD_HEIGHT;
let birdX = boardWidth + BASE_SPAWN_OFFSET;
let birdY = playerY - birdHeight; // Head level flight
let birdImg;

//physics
const SPEED_START = 10; // стартовая скорость (медленно)
const SPEED_MAX = 17; // максимальная скорость (конечная)
const MOBILE_SPEED_MAX = 12; // максимальная скорость на телефоне
const SPEED_MAX_SCORE = 10000; // до этого счёта скорость плавно растёт
const BASE_GRAVITY = 1.0;
const BASE_JUMP_VELOCITY = -22.9;
const MOBILE_GRAVITY_MULT = 1.05; // +5% sharpness
const MOBILE_JUMP_HEIGHT_MULT = 0.9; // -10% height
const MOBILE_JUMP_VELOCITY_MULT = Math.sqrt(MOBILE_JUMP_HEIGHT_MULT * MOBILE_GRAVITY_MULT);
let speed = SPEED_START;
let velocityX = -speed;
let velocityY = 0;
let gravity = BASE_GRAVITY;
let jumpVelocity = BASE_JUMP_VELOCITY;
let scoreFloat = 0;

// (Ручные паддинги убраны — хитбоксы строятся по альфа‑границам спрайтов)

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
    
    // Game UI elements
    gameCoinsEl = document.getElementById("game-coins");
    gameScoreEl = document.getElementById("game-score");
    gameBestEl = document.getElementById("game-best");
    gameUIContainer = document.querySelector(".game-ui");

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
    initWalletState();
    applyResponsiveLayout();
    board.height = boardHeight;
    board.width = boardWidth;

    context = board.getContext("2d");

    // Setup crisp rendering
    setupCrispCanvas();
    window.addEventListener("resize", setupCrispCanvas);

    //load player image (human character)
    playerImg = new Image();
    playerImg.src = "./assets/hum_vit_1.png";
    playerImg.onload = function() {
        spriteBounds.player = getNormalizedSpriteBounds(playerImg);
        applyObjectScale(objectScale);
        player.x = playerX + mobileEdgeGapWorld + mobileSafeLeftWorld;
        context.drawImage(playerImg, player.x, player.y, player.width, player.height);
    }

    //load token image (ground obstacle)
    tokenImg = new Image();
    tokenImg.src = "./assets/coin.png";
    tokenImg.onload = function() {
        spriteBounds.coin = getNormalizedSpriteBounds(tokenImg);
    }

    // load eth icon for coin UI
    ethImg = new Image();
    ethImg.src = "./assets/eth.png";

    //load bird image (flying enemy)
    birdImg = new Image();
    birdImg.src = "./assets/gen_bird.png";
    birdImg.onload = function() {
        spriteBounds.bird = getNormalizedSpriteBounds(birdImg);
    }

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
        startButton.disabled = !walletReady;
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
        startButton.disabled = !walletReady;
    }
    updateCheckinUI();
}

function applyProfileData(data) {
    if (!data) return;
    if (Number.isFinite(data.coinBalance)) {
        coinCount = data.coinBalance;
        saveCoins();
    }
    if (Number.isFinite(data.bestScore)) {
        bestScore = data.bestScore;
        localStorage.setItem("baseapp_runner_best_score", String(bestScore));
    }
    checkinState.lastCheckin = data.lastCheckin || null;
    checkinState.streak = Number.isFinite(data.streak) ? data.streak : 0;
    checkinState.message = "";
    updateCheckinUI();
}

function setCheckinButtonText(text) {
    if (!checkinButton) return;
    checkinButton.textContent = text;
}

function updateCheckinUI() {
    if (!checkinButton) return;
    
    if (!walletReady) {
        checkinButton.disabled = true;
        setCheckinButtonText("Check-in");
        if (checkinStatus) {
            checkinStatus.textContent = "";
            checkinStatus.classList.remove("success");
        }
        return;
    }
    if (!isValidAddress(CHECKIN_CONTRACT_ADDRESS)) {
        checkinButton.disabled = true;
        setCheckinButtonText("Check-in");
        if (checkinStatus) {
            checkinStatus.textContent = "Not available";
            checkinStatus.classList.remove("success");
        }
        return;
    }
    if (checkinState.loading) {
        checkinButton.disabled = true;
        setCheckinButtonText("Loading...");
        if (checkinStatus) {
            checkinStatus.textContent = "";
            checkinStatus.classList.remove("success");
        }
        return;
    }
    const checkedIn = isToday(checkinState.lastCheckin);
    checkinButton.disabled = checkedIn;
    setCheckinButtonText(checkedIn ? "Done" : "Check-in");
    
    if (checkinStatus) {
        if (checkinState.message) {
            checkinStatus.textContent = checkinState.message;
            checkinStatus.classList.toggle("success", checkedIn);
        } else if (checkedIn) {
            checkinStatus.textContent = `Streak: ${checkinState.streak}`;
            checkinStatus.classList.add("success");
        } else {
            checkinStatus.textContent = `Streak: ${checkinState.streak}`;
            checkinStatus.classList.remove("success");
        }
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
        if (checkinStatus) {
            checkinStatus.textContent = "Подтвердите транзакцию check-in.";
        }
        const txHash = await sendCheckinTransaction();
        const signature = await signWalletMessage(message);
        const submitResponse = await fetch(`${BACKEND_URL}/api/checkin/submit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({
                signature
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

async function startGameFromWelcome() {
    if (!walletReady) {
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
    if (currentUIState !== UI_STATE.RUNNING || gameOver) return;
    currentUIState = UI_STATE.PAUSED;
    isPaused = true;
    showWelcome = true;
    gameActive = true;
    updateUIState();
}

function openWalletMenu() {
    // Force back to connect/menu based on wallet state
    currentUIState = walletReady ? UI_STATE.MENU : UI_STATE.CONNECT;
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
    if (gameOver) return;
    if (currentUIState === UI_STATE.PAUSED) {
        resumeGame();
        return;
    }
    if (currentUIState === UI_STATE.RUNNING) {
        openPauseMenu();
    }
}

function applyResponsiveLayout() {
    const viewport = getViewportSize();
    const isMobile = viewport.width <= MOBILE_MAX_WIDTH;
    const viewportScale = Math.max(
        MOBILE_SCALE_MIN,
        Math.min(MOBILE_SCALE_MAX, viewport.width / MOBILE_BASE_WIDTH)
    );
    const nextObjectScale = isMobile ? MOBILE_OBJECT_SCALE * viewportScale : 1;
    let nextBoardWidth = BASE_BOARD_WIDTH;
    if (isMobile) {
        nextBoardWidth = Math.min(
            BASE_BOARD_WIDTH,
            Math.max(MOBILE_MIN_BOARD_WIDTH, Math.round(viewport.width * MOBILE_WIDTH_MULTIPLIER))
        );
    }
    const nextBoardHeight = BASE_BOARD_HEIGHT;

    const layoutChanged = boardWidth !== nextBoardWidth
        || boardHeight !== nextBoardHeight
        || objectScale !== nextObjectScale
        || isMobileLayout !== isMobile;

    if (!layoutChanged) {
        return;
    }

    const relativeY = player.y - playerY;
    const wasOnGround = player.y >= playerY;
    const wasDucking = isDucking;
    isMobileLayout = isMobile;
    objectScale = nextObjectScale;
    uiScale = isMobile ? MOBILE_UI_SCALE : 1;
    scorePadding = isMobile ? MOBILE_SCORE_PADDING : 10;
    scoreTop = isMobile ? MOBILE_SCORE_TOP : 10;
    gameOverYRatio = isMobile ? MOBILE_GAME_OVER_Y_RATIO : 0.5;
    restartGap = isMobile ? MOBILE_RESTART_GAP : 30;
    gravity = isMobile ? BASE_GRAVITY * MOBILE_GRAVITY_MULT : BASE_GRAVITY;
    jumpVelocity = isMobile ? BASE_JUMP_VELOCITY * MOBILE_JUMP_VELOCITY_MULT : BASE_JUMP_VELOCITY;
    boardWidth = nextBoardWidth;
    boardHeight = nextBoardHeight;
    groundY = boardHeight - PLATFORM_BOTTOM_MARGIN - PLATFORM_HEIGHT;
    updatePauseButtonVisibility();

    applyObjectScale(objectScale);
    playerY = groundY - playerHeight;
    tokenY = groundY - tokenHeight;
    birdY = getBirdFlyY();
    tokenX = boardWidth + BASE_SPAWN_OFFSET;
    birdX = boardWidth + BASE_SPAWN_OFFSET;

    player.x = playerX + mobileEdgeGapWorld + mobileSafeLeftWorld;
    player.width = playerWidth;
    player.height = wasDucking ? playerDuckHeight : playerHeight;

    for (let i = 0; i < tokenArray.length; i++) {
        const token = tokenArray[i];
        token.width = token.type === 1 ? token1Width : token.type === 2 ? token2Width : token3Width;
        token.height = tokenHeight;
        token.y = tokenY;
    }
    for (let i = 0; i < birdArray.length; i++) {
        const bird = birdArray[i];
        bird.width = birdWidth;
        bird.height = birdHeight;
        bird.y = birdY;
    }

    if (wasOnGround) {
        player.y = isDucking ? groundY - playerDuckHeight : playerY;
        velocityY = 0;
    } else {
        player.y = Math.min(playerY, playerY + relativeY);
    }
}

function applyObjectScale(scale) {
    playerWidth = Math.round(BASE_PLAYER_WIDTH * scale);
    playerHeight = Math.round(BASE_PLAYER_HEIGHT * scale);
    playerDuckHeight = Math.round(BASE_PLAYER_DUCK_HEIGHT * scale);
    const basePlayerX = isMobileLayout ? MOBILE_PLAYER_X : BASE_PLAYER_X;
    playerSpriteInsetX = spriteBounds.player ? Math.round(spriteBounds.player.x * playerWidth) : 0;
    playerX = Math.round(basePlayerX * scale) - playerSpriteInsetX;

    COIN_SIZE = Math.round(BASE_COIN_SIZE * scale);
    STICK_HEIGHT = Math.round(BASE_STICK_HEIGHT * scale);
    STICK_WIDTH = Math.max(2, Math.round(BASE_STICK_WIDTH * scale));
    COIN_SPACING = Math.round(BASE_COIN_SPACING * scale);

    token1Width = Math.round(BASE_TOKEN1_WIDTH * scale);
    token2Width = Math.round(BASE_TOKEN2_WIDTH * scale);
    token3Width = Math.round(BASE_TOKEN3_WIDTH * scale);
    tokenHeight = Math.round(BASE_TOKEN_HEIGHT * scale);

    birdWidth = Math.round(BASE_BIRD_WIDTH * scale);
    birdHeight = Math.round(BASE_BIRD_HEIGHT * scale);
}

function setupCrispCanvas() {
    // Handle device pixel ratio for crisp rendering
    applyResponsiveLayout();
    let dpr = window.devicePixelRatio || 1;

    renderScale = getRenderScale(dpr);
    mobileEdgeGapWorld = isMobileLayout ? MOBILE_PLAYER_EDGE_GAP / renderScale : 0;
    mobileSafeLeftWorld = isMobileLayout ? getSafeAreaLeftPx() / renderScale : 0;

    // Set actual canvas size with proper DPR + scale
    board.width = Math.floor(boardWidth * renderScale * dpr);
    board.height = Math.floor(boardHeight * renderScale * dpr);
    board.style.width = Math.floor(boardWidth * renderScale) + "px";
    board.style.height = Math.floor(boardHeight * renderScale) + "px";

    // Reset transform before applying DPR scaling
    context.setTransform(dpr * renderScale, 0, 0, dpr * renderScale, 0, 0);

    // Disable smoothing for stable, crisp rendering
    context.imageSmoothingEnabled = false;
    context.webkitImageSmoothingEnabled = false;
    context.mozImageSmoothingEnabled = false;
    context.msImageSmoothingEnabled = false;
}

function getRenderScale(dpr) {
    const viewport = getViewportSize();
    const header = document.querySelector("h1");
    let headerHeight = header ? header.getBoundingClientRect().height : 0;
    const bodyStyles = window.getComputedStyle(document.body);
    const paddingTop = parseFloat(bodyStyles.paddingTop) || 0;
    const paddingBottom = parseFloat(bodyStyles.paddingBottom) || 0;
    const paddingLeft = parseFloat(bodyStyles.paddingLeft) || 0;
    const paddingRight = parseFloat(bodyStyles.paddingRight) || 0;
    const availableWidth = viewport.width - paddingLeft - paddingRight;
    let availableHeight = viewport.height - paddingTop - paddingBottom - headerHeight - 12;
    if (availableHeight < boardHeight * 0.4) {
        headerHeight = 0;
        availableHeight = window.innerHeight - paddingTop - paddingBottom - 12;
    }
    const rawScale = Math.min(availableWidth / boardWidth, availableHeight / boardHeight);
    const cappedScale = isMobileLayout ? rawScale : Math.min(rawScale, 1);
    const clampedScale = Math.max(cappedScale, 0.1);
    if (isMobileLayout && dpr >= 2) {
        return Math.max(Math.round(clampedScale * dpr) / dpr, 0.1);
    }
    return Math.round(clampedScale * 100) / 100;
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
    const dtScale = deltaMs / FRAME_MS;
    
    // Freeze gameplay when gameOver but continue rendering
    const shouldUpdate = gameActive && !isPaused && !gameOver;
    const stepScale = shouldUpdate ? dtScale : 0;
    
    context.clearRect(0, 0, boardWidth, boardHeight);

    // Don't draw game elements when overlay is visible (except during game over)
    if (showWelcome && !gameActive && !gameOver) {
        return;
    }

    // плавное ускорение до максимума к счёту SPEED_MAX_SCORE
    const displayScore = Math.floor(scoreFloat);
    const speedProgress = Math.min(displayScore / SPEED_MAX_SCORE, 1);
    const maxSpeed = isMobileLayout ? MOBILE_SPEED_MAX : SPEED_MAX;
    speed = SPEED_START + (maxSpeed - SPEED_START) * speedProgress;
    velocityX = -speed;
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

    velocityY += gravity * stepScale;
    player.y = Math.min(player.y + velocityY * stepScale, playerGroundY);
    if (player.y >= playerGroundY) {
        velocityY = 0;
    }
    player.x = playerX + mobileEdgeGapWorld + mobileSafeLeftWorld;
    
    // Draw player with curl down animation for ducking
    let drawX = Math.round(player.x);
    let drawY = Math.round(player.y);
    let drawWidth = player.width;
    let drawHeight = player.height;
    
    if (canDuck) {
        // Visual ducking: scale sprite to match current duck height,
        // anchored to current player Y (works on ground and in air).
        const crouchScale = playerDuckHeight / playerHeight;
        const crouchHeight = drawHeight;
        const crouchWidth = Math.round(drawWidth * crouchScale);
        const crouchX = drawX + (drawWidth - crouchWidth) / 2; // Center horizontally
        const crouchY = drawY;

        // Store actual draw rect for hitbox alignment
        playerDrawRectScratch.x = Math.round(crouchX);
        playerDrawRectScratch.y = Math.round(crouchY);
        playerDrawRectScratch.width = Math.round(crouchWidth);
        playerDrawRectScratch.height = Math.round(crouchHeight);
        
        // Draw full sprite scaled down (shows head and body in crouch pose)
        context.drawImage(
            playerImg,
            crouchX, crouchY, crouchWidth, crouchHeight
        );
    } else {
        // Store actual draw rect for hitbox alignment
        playerDrawRectScratch.x = Math.round(drawX);
        playerDrawRectScratch.y = Math.round(drawY);
        playerDrawRectScratch.width = Math.round(drawWidth);
        playerDrawRectScratch.height = Math.round(drawHeight);

        // Normal standing: draw full sprite
        context.drawImage(playerImg, drawX, drawY, drawWidth, drawHeight);
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
            gameOver = true;
            // Update best score
            if (score > bestScore) {
                bestScore = score;
                localStorage.setItem('baseapp_runner_best_score', bestScore);
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
        applySpriteBounds(birdHitboxScratch, spriteBounds.bird, OBSTACLE_HITBOX_INSET, birdHitboxScratch);
        
        // Debug: draw bird hitbox if enabled
        if (debugHitboxes) {
            context.strokeStyle = 'green';
            context.lineWidth = 2;
            context.strokeRect(birdHitboxScratch.x, birdHitboxScratch.y, birdHitboxScratch.width, birdHitboxScratch.height);
        }
        
        // Use a head-focused hitbox for birds (prevents passing through head)
        let playerBirdHitbox = getPlayerBirdHitbox(playerBirdHitboxScratch);
        if (shouldUpdate && detectCollision(playerBirdHitbox, birdHitboxScratch)) {
            gameOver = true;
            // Update best score
            if (score > bestScore) {
                bestScore = score;
                localStorage.setItem('baseapp_runner_best_score', bestScore);
            }
        }
    }

    if (gameOver) {
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
    scoreFloat += stepScale;
    const nextScore = Math.floor(scoreFloat);
    if (nextScore !== score) {
        score = nextScore;
    }

    if (!backendSessionActive && score >= nextCoinScore) {
        const increments = Math.floor((score - nextCoinScore) / 10000) + 1;
        addCoins(increments);
        nextCoinScore += increments * 10000;
    }
    if (gameUIContainer) {
        updateGameUI();
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
        const coinX = Math.round(padding + mobileSafeLeftWorld);
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
        context.fillText(scoreText, scoreX, scoreY);
        context.fillText(bestText, bestX, bestY);
    }

    if (isPaused && !gameOver) {
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

    // GAME OVER overlay - always render when gameOver is true
    if (gameOver) {
        // Semi-transparent overlay
        context.fillStyle = "rgba(90, 90, 90, 0.55)";
        context.fillRect(0, 0, boardWidth, boardHeight);
        
        const gameOverText = "GAME OVER";
        const restartText = isMobileLayout ? "TAP to restart" : "Press SPACE to restart";
        const gameOverFont = Math.round(36 * uiScale);
        const restartFont = Math.round(16 * uiScale);
        
        // Center vertically in the play area
        const centerY = Math.round(boardHeight / 2);
        
        // Game over text with outline for visibility
        context.font = `bold ${gameOverFont}px "Arial Black", Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        
        context.strokeStyle = "#111";
        context.lineWidth = 6;
        context.strokeText(gameOverText, boardWidth / 2, centerY);
        
        context.fillStyle = "#d11c1c";
        context.fillText(gameOverText, boardWidth / 2, centerY);
        
        // Restart hint
        context.font = `${restartFont}px "Arial Black", Arial, sans-serif`;
        context.strokeStyle = "#111";
        context.lineWidth = 3;
        context.strokeText(restartText, boardWidth / 2, centerY + gameOverFont);
        context.fillStyle = "#f3f3f3";
        context.fillText(restartText, boardWidth / 2, centerY + gameOverFont);
        
        // Reset text align
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
    }
}

function drawTokenObstacle(token) {
    // Draw coins based on token type (1, 2, or 3 coins)
    const stickY = Math.round(groundY - STICK_HEIGHT);
    
    if (token.type === 1) {
        // Single coin - one stick
        const coinX = Math.round(token.x + (token.width - COIN_SIZE) / 2);
        const coinY = Math.round(stickY - COIN_SIZE);
        const stickX = Math.round(coinX + (COIN_SIZE - STICK_WIDTH) / 2);
        
        context.fillStyle = "#0052ff";
        context.fillRect(stickX, stickY, STICK_WIDTH, STICK_HEIGHT);
        drawCoin(coinX, coinY, COIN_SIZE);
    } else if (token.type === 2) {
        // Double coins - two sticks (one per coin)
        for (let i = 0; i < 2; i++) {
            const coinX = Math.round(token.x + i * COIN_SPACING + (token.width - COIN_SPACING) / 2 - COIN_SIZE / 2);
            const coinY = Math.round(stickY - COIN_SIZE);
            const stickX = Math.round(coinX + (COIN_SIZE - STICK_WIDTH) / 2);
            
            context.fillStyle = "#0052ff";
            context.fillRect(stickX, stickY, STICK_WIDTH, STICK_HEIGHT);
            drawCoin(coinX, coinY, COIN_SIZE);
        }
    } else if (token.type === 3) {
        // Triple coins - THREE sticks (one per coin)
        for (let i = 0; i < 3; i++) {
            const coinX = Math.round(token.x + i * COIN_SPACING + (token.width - 2 * COIN_SPACING) / 2 - COIN_SIZE / 2);
            const coinY = Math.round(stickY - COIN_SIZE);
            const stickX = Math.round(coinX + (COIN_SIZE - STICK_WIDTH) / 2);
            
            context.fillStyle = "#0052ff";
            context.fillRect(stickX, stickY, STICK_WIDTH, STICK_HEIGHT);
            drawCoin(coinX, coinY, COIN_SIZE);
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
    if (gameOver) {
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

    if (gameOver) {
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
    if (gameOver || !gameActive || isPaused) {
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
    return applySpriteBounds(playerDrawRectScratch, spriteBounds.player, PLAYER_HITBOX_INSET, out);
}

// Player hitbox for bird collisions (use the same, to match visuals)
function getPlayerBirdHitbox(out) {
    getPlayerHitbox(out);
    // Focus on upper body/head for bird collisions to avoid early hits
    const headHeight = Math.max(1, Math.round(out.height * 0.55));
    const insetX = Math.round(out.width * 0.1);
    out.x = out.x + insetX;
    out.width = Math.max(1, out.width - insetX * 2);
    out.height = headHeight;
    return out;
}

// Get token hitbox - union of coin(s) and stick(s), aligned to visible pixels
function getTokenHitbox(token, out) {
    const stickY = Math.round(groundY - STICK_HEIGHT);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const count = token.type;
    for (let i = 0; i < count; i++) {
        const coinX = Math.round(token.x + i * COIN_SPACING + (token.width - (count - 1) * COIN_SPACING) / 2 - COIN_SIZE / 2);
        const coinY = Math.round(stickY - COIN_SIZE);

        // Coin hitbox based on sprite bounds
        coinHitboxScratch.x = coinX;
        coinHitboxScratch.y = coinY;
        coinHitboxScratch.width = COIN_SIZE;
        coinHitboxScratch.height = COIN_SIZE;
        applySpriteBounds(coinHitboxScratch, spriteBounds.coin, OBSTACLE_HITBOX_INSET, coinHitboxScratch);

        // Stick hitbox (rect as drawn)
        const stickX = Math.round(coinX + (COIN_SIZE - STICK_WIDTH) / 2);
        stickHitboxScratch.x = stickX + OBSTACLE_HITBOX_INSET.left;
        stickHitboxScratch.y = stickY + OBSTACLE_HITBOX_INSET.top;
        stickHitboxScratch.width = Math.max(0, STICK_WIDTH - OBSTACLE_HITBOX_INSET.left - OBSTACLE_HITBOX_INSET.right);
        stickHitboxScratch.height = Math.max(0, STICK_HEIGHT - OBSTACLE_HITBOX_INSET.top - OBSTACLE_HITBOX_INSET.bottom);

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
    // Reset all game state variables
    gameOver = false;
    score = 0;
    scoreFloat = 0;
    nextCoinScore = 10000;
    speed = SPEED_START;
    velocityX = -speed;
    velocityY = 0;
    isDucking = false; // Reset duck state
    isPaused = false;
    lastFrameTime = null;
    gameActive = false;
    
    // Reset player position and size
    player.x = playerX + mobileEdgeGapWorld + mobileSafeLeftWorld;
    player.y = playerY;
    player.width = playerWidth; // Wider player sprite
    player.height = playerHeight; // Ensure normal height on restart (not ducked)
    
    // Clear obstacle arrays
    tokenArray = [];
    birdArray = [];
    await startBackendSession();
    gameActive = true;
}