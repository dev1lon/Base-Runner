// The same fixed-step rules run in the browser and during server verification.
(function (root) {
  'use strict';
  const FRAME_MS = 1000 / 60;
  const VERSION = 2;
  // Opaque bounds of the shipped PNGs (alpha > 10), in character ID order.
  const BOUNDS = [
    [.235491,.069444,.517857,.821181], [.229911,.078125,.521205,.809896],
    [.234375,.096354,.520089,.795139], [.223380,.046007,.541667,.845486],
    [.243304,.148438,.517857,.741319], [.235491,.053819,.520089,.837674],
    [.234375,.071181,.520089,.820312], [.193080,.085938,.500000,.854167],
    [.234375,.086806,.521205,.804688], [.235491,.074653,.513393,.817708],
  ];
  function rngFor(seed) {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
      let t = h += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createRun(seed, config = {}) {
    const bounds = BOUNDS[config.characterId] || BOUNDS[0];
    return {
      frame: 0, score: 0, over: false, ducking: false, canDuck: false,
      x: 10 - bounds[0] * 63, y: 220, height: 80, velocityY: 0,
      tokens: [], birds: [], bounds, rng: rngFor(seed),
      width: Math.max(300, Math.min(2000, Number(config.boardWidth) || 750)),
      multiplier: [1, 1.1, 1.2, 1.3, 1.5, 2][config.characterLevel] || 1,
      speedTesting: config.speedTesting === true,
      speedTestTier: config.speedTesting === true ? Math.max(0, Math.min(10, config.speedTestTier || 0)) : 0,
    };
  }
  function rect(x, y, width, height, bounds = [0,0,1,1], bottom = 3) {
    return {x: x + bounds[0] * width + 3, y: y + bounds[1] * height + 3,
      width: Math.max(0, bounds[2] * width - 6), height: Math.max(0, bounds[3] * height - 3 - bottom)};
  }
  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function spawn(run) {
    const chance = run.rng();
    if (chance <= .35) return;
    let type = 0;
    if (chance > .55) { const r = run.rng(); type = r > .9 ? 3 : r > .7 ? 2 : 1; }
    let x = run.width + 150;
    const blocked = () => [...run.tokens, ...run.birds].some(o => Math.abs(o.x - x) < 350);
    for (let attempt = 0; blocked() && attempt < 5; attempt++) x += 350;
    if (blocked()) return;
    if (type) run.tokens.push({x, y: 260, width: 20 + (type - 1) * 22, height: 40, type});
    else run.birds.push({x, y: 220 + run.bounds[1] * 80 - 40 + 5, width: 40, height: 40});
  }
  function stepRun(run, inputs = []) {
    if (run.over) return run;
    for (const type of inputs) {
      if (type === 'jump' && run.y >= 300 - run.height - 1) run.velocityY = -16;
      else if (type === 'duck_down') run.ducking = true;
      else if (type === 'duck_up') run.ducking = false;
      else if (run.speedTesting && /^speed:(?:[0-9]|10)$/.test(type)) run.speedTestTier = Number(type.slice(6));
    }
    const airborne = run.y < 300 - run.height - 1;
    run.canDuck = run.ducking && !airborne;
    run.height = run.canDuck ? 55 : 80;
    const ground = 300 - run.height;
    if (!airborne) run.y = ground;
    run.velocityY += .8;
    run.y = Math.min(run.y + run.velocityY, ground);
    if (run.y >= ground) run.velocityY = 0;
    const adjusted = Math.floor(run.score * run.multiplier);
    const tier = adjusted < 10000 ? 0 : Math.floor(Math.log2(adjusted / 10000)) + 1;
    const speed = 4 * Math.pow(1.1, Math.max(tier, run.speedTestTier));
    for (const list of [run.tokens, run.birds]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].x -= speed;
        if (list[i].x + list[i].width < 0) list.splice(i, 1);
      }
    }
    if (run.frame > 0 && run.frame % 60 === 0) spawn(run);
    const width = run.canDuck ? 63 * 55 / 80 : 63;
    const player = rect(run.x + (63 - width) / 2, run.y, width, run.height, run.bounds, 6);
    for (const token of run.tokens) {
      const hit = {x: token.x + 3, y: 263, width: token.width - 6, height: 34};
      if (overlaps(player, hit)) run.over = true;
    }
    const birdPlayer = {...player, x: player.x + player.width * .1, width: player.width * .8};
    for (const bird of run.birds) {
      if (overlaps(birdPlayer, rect(bird.x, bird.y, 40, 40, [.0301,.22716,.956522,.617284]))) run.over = true;
    }
    if (!run.over) run.score++;
    run.frame++;
    return run;
  }
  function simulateRun({seed, frameCount, inputEvents, config}) {
    if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 216000) throw new Error('Invalid frame count');
    if (!Array.isArray(inputEvents) || inputEvents.length > 20000) throw new Error('Invalid input log');
    let previous = -1;
    for (const ev of inputEvents) {
      if (!ev || !Number.isSafeInteger(ev.frame) || ev.frame < previous || ev.frame < 0 || ev.frame >= frameCount
        || (!['jump', 'duck_down', 'duck_up'].includes(ev.type)
          && !(config?.speedTesting === true && /^speed:(?:[0-9]|10)$/.test(ev.type)))) throw new Error('Invalid input log');
      previous = ev.frame;
    }
    const run = createRun(seed, config);
    let index = 0;
    while (run.frame < frameCount && !run.over) {
      const inputs = [];
      while (index < inputEvents.length && inputEvents[index].frame === run.frame) inputs.push(inputEvents[index++].type);
      stepRun(run, inputs);
    }
    return {score: run.score, frameCount: run.frame, over: run.over};
  }
  const api = {VERSION, FRAME_MS, createRun, stepRun, simulateRun};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunEngine = api;
})(globalThis);
