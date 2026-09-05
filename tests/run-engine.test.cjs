const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../backend/src/run-engine');
const game = fs.readFileSync(require.resolve('../script.js'), 'utf8');

test('browser engine and server replay agree for characters, widths and boosts', () => {
  const browser = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../backend/src/run-engine'), 'utf8'), browser);
  for (const boardWidth of [300, 750, 1400]) {
    for (const characterId of [0, 5, 9]) {
      for (const characterLevel of [0, 5]) {
        const config = {boardWidth, characterId, characterLevel};
        const run = browser.RunEngine.createRun('regression', config);
        const log = [];
        while (!run.over && run.frame < 4000) {
          const inputs = [];
          if (run.tokens.some(t => t.x > run.x && t.x - run.x < 100) && run.y >= 300 - run.height - 1) inputs.push('jump');
          const duck = run.birds.some(b => b.x > run.x - 40 && b.x - run.x < 110);
          if (duck !== run.ducking) inputs.push(duck ? 'duck_down' : 'duck_up');
          inputs.forEach(type => log.push({frame: run.frame, type}));
          browser.RunEngine.stepRun(run, inputs);
        }
        const replay = engine.simulateRun({seed: 'regression', frameCount: run.frame, inputEvents: log, config});
        assert.deepEqual(replay, {score: run.score, frameCount: run.frame, over: run.over});
        assert.ok(log.length > 0);
      }
    }
  }
});

test('invalid or unbounded replay inputs fail before simulation', () => {
  const valid = {seed: 'test', frameCount: 100, inputEvents: []};
  for (const frameCount of [-1, 0, 1.5, 216001, Infinity, '100']) {
    assert.throws(() => engine.simulateRun({...valid, frameCount}), /Invalid frame count/);
  }
  for (const inputEvents of [null, [{t: 1, type: 'jump'}], [{frame: 100, type: 'jump'}],
    [{frame: 1, type: 'teleport'}], [{frame: 2, type: 'jump'}, {frame: 1, type: 'jump'}]]) {
    assert.throws(() => engine.simulateRun({...valid, inputEvents}), /Invalid input log/);
  }
});

test('render rates and pauses do not change simulated time or replay', () => {
  const ctx = vm.createContext({
    RunEngine: engine, verifiedRun: engine.createRun('frames', {boardWidth: 750}),
    backendSessionActive: true, runFrameRemainder: 0, runInputQueue: [], backendInputLog: [],
    boardWidth: 750, gameScale: 1, groundY: 300, player: {}, tokenArray: [], birdArray: [],
    rawScore: 0, score: 0, scoreFloat: 0, GAME_STATE: {GAME_OVER: 'over'}, gameState: 'running',
    getAdjustedScore: value => value, setGameOverState() {}, handleGameOver() {},
  });
  vm.runInContext(game.slice(game.indexOf('function advanceVerifiedRun('), game.indexOf('function update(timestamp)')), ctx);
  ctx.advanceVerifiedRun(100, true);
  assert.equal(ctx.verifiedRun.frame, 6);
  ctx.advanceVerifiedRun(10000, false);
  assert.equal(ctx.verifiedRun.frame, 6);
  ctx.runInputQueue.push('jump');
  for (let i = 0; i < 12; i++) ctx.advanceVerifiedRun(1000 / 120, true);
  assert.equal(ctx.verifiedRun.frame, 12);
  const replay = engine.simulateRun({seed: 'frames', frameCount: 12, inputEvents: [{frame: 6, type: 'jump'}], config: {boardWidth: 750}});
  assert.equal(ctx.score, replay.score);
  assert.ok(ctx.verifiedRun.y < 220);
});

test('all Save button labels omit the price', () => {
  for (const file of ['../script.js', '../frontend/index.html']) {
    const text = fs.readFileSync(require.resolve(file), 'utf8');
    assert.doesNotMatch(text, /Save record to leaderboard[^\n<']*\$0\.10/);
  }
});

test('speed preview inputs require an admin-authorized session', () => {
  const inputEvents = [{frame: 20, type: 'speed:3'}, {frame: 60, type: 'speed:1'}];
  assert.throws(() => engine.simulateRun({seed: 'admin', frameCount: 100, inputEvents}), /Invalid input log/);
  const config = {speedTesting: true, speedTestTier: 2};
  const run = engine.createRun('admin', config);
  while (run.frame < 100 && !run.over) {
    engine.stepRun(run, inputEvents.filter(e => e.frame === run.frame).map(e => e.type));
  }
  const replay = engine.simulateRun({seed: 'admin', frameCount: run.frame, inputEvents, config});
  assert.equal(replay.score, run.score);
  assert.equal(run.speedTestTier, 1);
});
