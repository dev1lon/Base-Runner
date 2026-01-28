// Synced with frontend script.js BASE_* constants
const DEFAULT_CONFIG = {
  frameMs: 1000 / 60,
  boardWidth: 750,
  boardHeight: 400,
  platformYRatio: 0.75, // Ground at 75% of canvas height
  baseSpawnOffset: 150,
  spawnGap: 350, // SPAWN_X_GAP in frontend
  speedStart: 4,
  speedMax: 4,
  speedMaxScore: 10000,
  gravity: 0.8,
  jumpVelocity: -16,
  player: {
    width: 63,
    height: 80,
    duckHeight: 55,
    x: 10
  },
  token: {
    height: 40, // BASE_STICK_HEIGHT + BASE_COIN_SIZE = 20 + 20
    widthByType: {
      1: 20,  // BASE_COIN_SIZE
      2: 42,  // BASE_COIN_SPACING + BASE_COIN_SIZE = 22 + 20
      3: 64   // BASE_COIN_SPACING * 2 + BASE_COIN_SIZE = 44 + 20
    }
  },
  coin: {
    size: 20,
    stickHeight: 20,
    stickWidth: 3,
    spacing: 22
  },
  bird: {
    width: 40,
    height: 40,
    headAlignOffset: 15,
    lowerByPct: 0.1
  },
  hitbox: {
    playerInset: { top: 1, bottom: 2, left: 1, right: 1 },
    obstacleInset: { top: 1, bottom: 1, left: 1, right: 1 }
  }
};

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

function applyInsets(rect, inset) {
  const x = rect.x + inset.left;
  const y = rect.y + inset.top;
  const width = rect.width - inset.left - inset.right;
  const height = rect.height - inset.top - inset.bottom;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function normalizeInputs(inputEvents) {
  if (!Array.isArray(inputEvents)) return [];
  const normalized = [];
  for (const ev of inputEvents) {
    if (!ev || typeof ev !== "object") continue;
    const t = Number(ev.t);
    const type = String(ev.type || "").toLowerCase();
    if (!Number.isFinite(t) || t < 0) continue;
    if (type === "jump" || type === "duck_down" || type === "duck_up") {
      normalized.push({ t, type });
    }
  }
  normalized.sort((a, b) => a.t - b.t);
  return normalized;
}

function isSpawnXClear(spawnX, minGap, tokens, birds) {
  for (const token of tokens) {
    if (Math.abs(token.x - spawnX) < minGap) return false;
  }
  for (const bird of birds) {
    if (Math.abs(bird.x - spawnX) < minGap) return false;
  }
  return true;
}

function adjustSpawnX(spawnX, minGap, tokens, birds) {
  let adjusted = spawnX;
  let attempts = 0;
  while (!isSpawnXClear(adjusted, minGap, tokens, birds) && attempts < 3) {
    adjusted += minGap;
    attempts += 1;
  }
  return adjusted;
}

function getPlayerDrawRect(state, config) {
  const { player } = config;
  const isDuck = state.canDuck;
  const drawWidth = player.width;
  const drawHeight = state.playerHeight;
  if (!isDuck) {
    return {
      x: Math.round(state.playerX),
      y: Math.round(state.playerY),
      width: Math.round(drawWidth),
      height: Math.round(drawHeight)
    };
  }
  const crouchScale = player.duckHeight / player.height;
  const crouchWidth = Math.round(drawWidth * crouchScale);
  const crouchX = Math.round(state.playerX + (drawWidth - crouchWidth) / 2);
  return {
    x: crouchX,
    y: Math.round(state.playerY),
    width: crouchWidth,
    height: Math.round(drawHeight)
  };
}

function getPlayerHitbox(state, config) {
  const rect = getPlayerDrawRect(state, config);
  return applyInsets(rect, config.hitbox.playerInset);
}

function getBirdHitbox(bird, config) {
  return applyInsets(bird, config.hitbox.obstacleInset);
}

function getTokenHitbox(token, config) {
  const { coin, boardHeight, platformYRatio } = config;
  const groundY = Math.round(boardHeight * platformYRatio);
  const stickY = Math.round(groundY - coin.stickHeight);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const count = token.type;
  for (let i = 0; i < count; i++) {
    const coinX = Math.round(
      token.x +
        i * coin.spacing +
        (token.width - (count - 1) * coin.spacing) / 2 -
        coin.size / 2
    );
    const coinY = Math.round(stickY - coin.size);
    const coinRect = applyInsets(
      { x: coinX, y: coinY, width: coin.size, height: coin.size },
      config.hitbox.obstacleInset
    );
    const stickX = Math.round(coinX + (coin.size - coin.stickWidth) / 2);
    const stickRect = {
      x: stickX,
      y: stickY,
      width: coin.stickWidth,
      height: coin.stickHeight
    };

    minX = Math.min(minX, coinRect.x, stickRect.x);
    minY = Math.min(minY, coinRect.y, stickRect.y);
    maxX = Math.max(
      maxX,
      coinRect.x + coinRect.width,
      stickRect.x + stickRect.width
    );
    maxY = Math.max(
      maxY,
      coinRect.y + coinRect.height,
      stickRect.y + stickRect.height
    );
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY)
  };
}

function simulateRun({
  seed,
  durationMs,
  inputEvents,
  config: configOverride
}) {
  const config = { ...DEFAULT_CONFIG, ...(configOverride || {}) };
  const rng = createRng(seed);
  const inputs = normalizeInputs(inputEvents);

  // Ground level based on platform ratio (same as frontend)
  const groundY = Math.round(config.boardHeight * config.platformYRatio);
  
  const state = {
    playerX: config.player.x,
    playerY: groundY - config.player.height,
    playerHeight: config.player.height,
    velocityY: 0,
    isDucking: false,
    canDuck: false,
    scoreFloat: 0
  };

  const tokens = [];
  const birds = [];
  const tokenY = groundY - config.token.height;
  const tokenX = config.boardWidth + config.baseSpawnOffset;
  const birdX = config.boardWidth + config.baseSpawnOffset;
  const standingHeadTop = groundY - config.player.height;
  let nextSpawnMs = 1000;
  let gameOver = false;
  let collidedAtMs = null;

  let inputIndex = 0;
  const frameMs = config.frameMs;
  const maxFrames = Math.ceil(durationMs / frameMs);

  for (let frame = 0; frame < maxFrames; frame++) {
    const timeMs = frame * frameMs;

    while (inputIndex < inputs.length && inputs[inputIndex].t <= timeMs) {
      const ev = inputs[inputIndex];
      if (ev.type === "jump") {
        const playerGroundY = groundY - state.playerHeight;
        if (state.playerY >= playerGroundY - 1) {
          state.velocityY = config.jumpVelocity;
        }
      } else if (ev.type === "duck_down") {
        state.isDucking = true;
      } else if (ev.type === "duck_up") {
        state.isDucking = false;
      }
      inputIndex += 1;
    }

    const displayScore = Math.floor(state.scoreFloat);
    const speedProgress = Math.min(displayScore / config.speedMaxScore, 1);
    const speed = config.speedStart + (config.speedMax - config.speedStart) * speedProgress;
    const frameVelocityX = -speed;

    const prevY = state.playerY;
    const prevHeight = state.playerHeight;
    const prevGroundY = groundY - prevHeight;
    const wasAirborne = prevY < prevGroundY - 1;
    const onGround = !wasAirborne;
    state.canDuck = state.isDucking && onGround;

    state.playerHeight = state.canDuck ? config.player.duckHeight : config.player.height;
    const playerGroundY = groundY - state.playerHeight;

    if (wasAirborne) {
      state.playerY = prevY;
    } else {
      state.playerY = playerGroundY;
      if (state.velocityY > 0) {
        state.velocityY = 0;
      }
    }

    state.velocityY += config.gravity;
    state.playerY = Math.min(state.playerY + state.velocityY, playerGroundY);
    if (state.playerY >= playerGroundY) {
      state.velocityY = 0;
    }

    for (let i = tokens.length - 1; i >= 0; i--) {
      tokens[i].x += frameVelocityX;
      if (tokens[i].x + tokens[i].width < 0) {
        tokens.splice(i, 1);
      }
    }
    for (let i = birds.length - 1; i >= 0; i--) {
      birds[i].x += frameVelocityX;
      if (birds[i].x + birds[i].width < 0) {
        birds.splice(i, 1);
      }
    }

    if (timeMs >= nextSpawnMs) {
      const placeChance = rng();
      if (placeChance > 0.55) {
        const typeChance = rng();
        let tokenType = 1;
        if (typeChance > 0.9) tokenType = 3;
        else if (typeChance > 0.7) tokenType = 2;
        const tokenWidth = config.token.widthByType[tokenType];
        tokens.push({
          x: adjustSpawnX(tokenX, config.spawnGap, tokens, birds),
          y: tokenY,
          width: tokenWidth,
          height: config.token.height,
          type: tokenType
        });
      } else if (placeChance > 0.35) {
        let headLevelY = standingHeadTop - config.bird.height + config.bird.headAlignOffset;
        headLevelY += config.bird.height * config.bird.lowerByPct;
        birds.push({
          x: adjustSpawnX(birdX, config.spawnGap, tokens, birds),
          y: headLevelY,
          width: config.bird.width,
          height: config.bird.height
        });
      }
      nextSpawnMs += 1000;
    }

    const playerHitbox = getPlayerHitbox(state, config);

    for (const token of tokens) {
      const tokenHitbox = getTokenHitbox(token, config);
      if (rectsOverlap(playerHitbox, tokenHitbox)) {
        gameOver = true;
        collidedAtMs = timeMs;
        break;
      }
    }
    if (!gameOver) {
      for (const bird of birds) {
        const birdHitbox = getBirdHitbox(bird, config);
        if (rectsOverlap(playerHitbox, birdHitbox)) {
          gameOver = true;
          collidedAtMs = timeMs;
          break;
        }
      }
    }

    state.scoreFloat += 1;
    if (gameOver) break;
  }

  return {
    score: Math.floor(state.scoreFloat),
    collidedAtMs,
    config
  };
}

module.exports = {
  DEFAULT_CONFIG,
  simulateRun
};
