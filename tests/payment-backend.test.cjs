const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {ethers} = require('../backend/node_modules/ethers');
const engine = require('../backend/src/run-engine');
const source = fs.readFileSync(require.resolve('../backend/src/index.js'), 'utf8');
const address = '0x' + '12'.repeat(20);
const contract = '0x' + '34'.repeat(20);
const hash = '0x' + 'ab'.repeat(32);
const upperHash = '0x' + hash.slice(2).toUpperCase();
const topics = {
  coins: ethers.id('CoinsPurchased(address,uint256,uint256,uint256,uint256)'),
  paid: ethers.id('PaidGame(address,uint256,uint256,uint256,uint256)'),
  save: ethers.id('LeaderboardSaved(address,uint256,uint256,uint256,uint256,uint256)'),
};
function loadModule(file, dependencies) {
  const context = vm.createContext({module: {exports: {}}, require: name => dependencies[name], Date, console});
  vm.runInContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
  return context.module.exports;
}
function section(from, to) {return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));}

// Transactional DB double: committed state is separate from each transaction's
// writes. Failures exercise the production BEGIN/ROLLBACK/COMMIT wrapper.
function harness() {
  let state = {payments: [], sessions: {}, user: {coins: 0, best_score: 10000, leaderboard_score: 0}};
  const flags = {failUpdate: false, failClaim: false, receiptAddress: contract, paidScore: 200, rpcCalls: 0};
  let queue = Promise.resolve();
  async function query(target, sql, params = []) {
    if (sql.startsWith('SELECT pg_advisory')) return {rows: []};
    if (sql.includes('SELECT address, result FROM used_tx_hashes')) {
      assert.match(sql, /lower\(tx_hash\)/);
      return {rows: target.payments.filter(row => row.tx_hash.toLowerCase() === params[0] && row.kind === params[1])};
    }
    if (sql.startsWith('INSERT INTO used_tx_hashes')) {
      if (flags.failClaim) throw Error('injected claim failure');
      target.payments.push({tx_hash: params[0], kind: params[1], address: params[2], result: JSON.parse(params[3])});
      return {rows: []};
    }
    if (sql.startsWith('INSERT INTO game_sessions')) {
      target.sessions[params[0]] = {address: params[1], state: JSON.parse(params[2]), result: null};
      return {rows: []};
    }
    if (sql.includes('FROM game_sessions WHERE session_id')) return {rows: target.sessions[params[0]] ? [target.sessions[params[0]]] : []};
    if (sql.startsWith('UPDATE game_sessions SET result')) {
      target.sessions[params[0]].result = JSON.parse(params[1]); return {rows: []};
    }
    if (sql.startsWith('SELECT best_score')) return {rows: [{...target.user}]};
    if (sql.startsWith('UPDATE users')) {
      if (flags.failUpdate) throw Error('injected update failure');
      assert.equal(params[0], address);
      if (sql.includes('leaderboard_score = GREATEST')) target.user.leaderboard_score = Math.max(target.user.leaderboard_score, params[1]);
      else {
        target.user.coins += params[1];
        if (sql.includes('best_score = GREATEST')) target.user.best_score = Math.max(target.user.best_score, params[2]);
      }
      return {rows: [{...target.user}]};
    }
    throw Error('Unexpected SQL: ' + sql);
  }
  class Pool {
    async connect() {
      const prior = queue;
      let unlock;
      queue = new Promise(resolve => {unlock = resolve;});
      await prior;
      let draft;
      return {
        query: async (sql, params) => {
          if (sql === 'BEGIN') {draft = structuredClone(state); return;}
          if (sql === 'COMMIT') {state = draft; return;}
          if (sql === 'ROLLBACK') return;
          return query(draft, sql, params);
        },
        release: unlock,
      };
    }
    async query(sql, params) {return query(state, sql, params);}
  }
  const dbContext = vm.createContext({module: {exports: {}}, require: () => ({Pool}), process: {env: {}}, console});
  vm.runInContext(fs.readFileSync(require.resolve('../backend/src/shared/db'), 'utf8'), dbContext);
  const db = dbContext.module.exports;
  const payments = loadModule('../backend/src/shared/payments', {'./db': db});
  const sessions = loadModule('../backend/src/modules/session/sessionStore', {'crypto': crypto, '../../shared/db': db});
  const routes = {};
  const context = vm.createContext({
    ...payments, ...sessions, ...engine, Date, FRAME_MS: engine.FRAME_MS,
    require: () => db, requireAuth() {}, rateLimit: () => () => {}, isAdminAddress: () => false,
    randomSeed: () => 'audit-seed', getCharacterLevel: async () => 0, SESSION_TTL_MS: 3600000,
    app: {post: (url, ...handlers) => {routes[url] = handlers.at(-1);}},
    console: {log() {}, warn() {}, error() {}}, setTimeout: callback => callback(),
    PAYMENTS_CONTRACT: contract, PAID_GAME_TOPICS: new Set([topics.paid]),
    LEADERBOARD_SAVED_TOPICS: new Set([topics.save]), COINS_PURCHASED_TOPICS: new Set([topics.coins]),
    VALID_COIN_PACKAGES: new Set([10]), LEVEL_SCORE_MULTIPLIER: [1,1.1,1.2,1.3,1.5,2], LEVEL_COIN_BONUS: [0,1,2,3,4,5],
    withRpcFallback: async fn => fn({getTransactionReceipt: async () => {
      flags.rpcCalls++;
      const log = (topic, words) => ({address: flags.receiptAddress,
        topics: [topic, '0x' + address.slice(2).padStart(64, '0')],
        data: '0x' + words.map(n => BigInt(n).toString(16).padStart(64,'0')).join('')});
      return {status: 1, logs: [log(topics.coins, [10, 1000000, 1, 1]),
        log(topics.paid, [100, 100, 1, 1]), log(topics.save, [flags.paidScore, 100, 100, 1, 1])]};
    }}),
  });
  vm.runInContext(section('function readEventWords(', 'refreshOnChainPrices();'), context);
  vm.runInContext(section('function sessionOptions(', 'app.get("/api/user/me"'), context);
  vm.runInContext(section('// Preflight avoids charging', '// Manual refresh endpoint'), context);
  vm.runInContext(section('app.post("/api/shop/buy-coins"', '// Note: record-purchase removed'), context);
  async function call(url, body) {
    const response = {status: 200};
    const res = {status(code) {response.status = code; return this;}, json(body) {response.body = body; return this;}};
    await routes[url]({body, user: {address}}, res);
    return response;
  }
  return {call, flags, context, state: () => state};
}

test('mixed-case concurrent coin-payment retries credit only once', async () => {
  const h = harness();
  const responses = await Promise.all([hash, upperHash, hash].map(txHash => h.call('/api/shop/buy-coins', {coins: 10, txHash})));
  for (const r of responses) assert.equal(r.body.ok, true);
  assert.equal(h.state().user.coins, 10);
  assert.equal(h.state().payments.length, 1);
  assert.equal(h.state().payments[0].tx_hash, hash);
  assert.equal(h.flags.rpcCalls, 1);
});

test('historical mixed-case claims are also protected', async () => {
  const h = harness();
  h.state().payments.push({tx_hash: upperHash, kind: 'coin_purchase', address, result: null});
  const response = await h.call('/api/shop/buy-coins', {coins: 10, txHash: hash});
  assert.equal(response.body.error, 'Transaction already used');
  assert.equal(h.state().user.coins, 0);
});

test('failed leaderboard write leaves payment reusable', async () => {
  const h = harness(); h.flags.failUpdate = true;
  assert.equal((await h.call('/api/leaderboard/save', {score: 200, txHash: hash})).body.ok, false);
  assert.equal(h.state().payments.length, 0);
  h.flags.failUpdate = false;
  assert.equal((await h.call('/api/leaderboard/save', {score: 200, txHash: hash})).body.ok, true);
  assert.equal(h.state().user.leaderboard_score, 200);
});

test('failed claim persistence rolls back the coin grant', async () => {
  const h = harness(); h.flags.failClaim = true;
  assert.equal((await h.call('/api/shop/buy-coins', {coins: 10, txHash: hash})).body.ok, false);
  assert.equal(h.state().user.coins, 0);
  assert.equal(h.state().payments.length, 0);
});

test('only the configured contract and paid score can grant a leaderboard record', async () => {
  const h = harness(); h.flags.receiptAddress = address;
  assert.equal((await h.call('/api/leaderboard/save', {score: 200, txHash: hash})).body.ok, false);
  h.flags.receiptAddress = contract;
  assert.equal((await h.call('/api/leaderboard/save', {score: 201, txHash: hash})).body.error, 'Score does not match payment');
  assert.equal(h.state().payments.length, 0);
});

test('confirmed payments remain valid after the current quote moves', async () => {
  const h = harness();
  h.context.livePrices = {saveLeaderboardWei: 1000000000n};
  assert.equal((await h.call('/api/leaderboard/save', {score: 200, txHash: hash})).body.ok, true);
});

test('paid-session retries return the same durable session', async () => {
  const h = harness();
  const body = {txHash: hash, characterId: 0, boardWidth: 750, gameVersion: engine.VERSION};
  const a = await h.call('/api/session/start-paid', body);
  const b = await h.call('/api/session/start-paid', {...body, txHash: upperHash});
  assert.equal(a.body.ok, true);
  assert.equal(a.body.sessionId, b.body.sessionId);
  assert.equal(Object.keys(h.state().sessions).length, 1);
});

test('fabricated waiting-only 3000 points are rejected by replay', async () => {
  const h = harness();
  const start = await h.call('/api/session/start', {characterId: 0, boardWidth: 750, gameVersion: engine.VERSION});
  h.state().sessions[start.body.sessionId].state.issuedAt -= 60000;
  const result = await h.call('/api/session/submit', {sessionId: start.body.sessionId,
    reportedScore: 3000, frameCount: 3000, inputLog: [], gameVersion: engine.VERSION});
  assert.equal(result.body.error, 'Score does not match replay');
  assert.equal(h.state().user.coins, 0);
});

test('valid replay is accepted and duplicate submits return the stored result', async () => {
  const h = harness();
  const start = await h.call('/api/session/start', {characterId: 0, boardWidth: 750, gameVersion: engine.VERSION});
  const run = engine.createRun(start.body.seed, start.body);
  while (!run.over) engine.stepRun(run);
  h.state().sessions[start.body.sessionId].state.issuedAt -= 60000;
  const body = {sessionId: start.body.sessionId, reportedScore: run.score, frameCount: run.frame, inputLog: [], gameVersion: engine.VERSION};
  const a = await h.call('/api/session/submit', body);
  const b = await h.call('/api/session/submit', body);
  assert.equal(a.body.ok, true);
  assert.equal(JSON.stringify(a.body), JSON.stringify(b.body));
  assert.equal(h.state().user.coins, a.body.coinsAwarded);
});
