const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../script.js'), 'utf8');
const receiptCode = source.slice(source.indexOf('function confirmedCallsTxHash('), source.indexOf('async function waitForTransactionHash('));
const saveCode = source.slice(source.indexOf('function paymentKey('), source.indexOf('function setWalletError('));
const txHash = '0x' + 'ab'.repeat(32);
const callsId = 'wallet-batch-id';
const receipts = [{ transactionHash: txHash }];

function harness(statuses, extra = {}) {
    let polls = 0;
    const context = vm.createContext({
        window: { __walletBridge: { getCallsStatus: async () => statuses[Math.min(polls++, statuses.length - 1)] } },
        getEthereumProvider: () => null,
        setTimeout: (callback) => callback(),
        console,
        ...extra,
    });
    vm.runInContext(receiptCode, context);
    return { context, polls: () => polls };
}

test('bridge and raw provider return receipt hashes for successful wallet statuses', async () => {
    for (const status of ['success', 'CONFIRMED', 'SUCCESS', 'completed', 200, '200']) {
        const { context } = harness([{ status, receipts }]);
        assert.equal(await context.waitForBridgeCallsTxHash(callsId), txHash);
        assert.equal(await context.waitForCallsTxHash({ request: async () => ({ status, receipts }) }, callsId), txHash);
    }
});

test('success without receipts keeps polling, including when the batch ID looks like a hash', async () => {
    const { context, polls } = harness([
        { status: 'pending' },
        { status: 'success', receipts: [] },
        { status: 'success', receipts },
    ]);
    assert.equal(await context.waitForBridgeCallsTxHash('0x' + 'cd'.repeat(32)), txHash);
    assert.equal(polls(), 3);
});

test('missing or malformed receipt hashes time out instead of returning the batch ID', async () => {
    for (const receipt of [[], [{ transactionHash: 'invalid' }]]) {
        const { context, polls } = harness([{ status: 'success', receipts: receipt }]);
        await assert.rejects(context.waitForBridgeCallsTxHash(callsId), /Transaction timeout/);
        assert.equal(polls(), 60);
    }
});

test('viem and RPC failure statuses stop polling immediately', async () => {
    for (const status of ['failure', 'FAILED', 400, 500, 600]) {
        const { context, polls } = harness([{ status, receipts }]);
        await assert.rejects(context.waitForBridgeCallsTxHash(callsId), /Transaction failed/);
        assert.equal(polls(), 1);
    }
});

test('bridge uses the provider when its status method is unavailable', async () => {
    const { context } = harness([]);
    context.window.__walletBridge = {
        provider: { request: async ({ method, params }) => {
            assert.equal(method, 'wallet_getCallsStatus');
            assert.deepEqual(Array.from(params), [callsId]);
            return { status: 200, receipts };
        } },
    };
    assert.equal(await context.waitForBridgeCallsTxHash(callsId), txHash);
});

test('no status API fails instead of treating a batch ID as payment', async () => {
    const { context } = harness([]);
    context.window.__walletBridge = {};
    await assert.rejects(context.waitForBridgeCallsTxHash(callsId), /cannot retrieve/);
});

function saveHarness(options = {}) {
    const button = { disabled: false, textContent: '' };
    const requests = [];
    const storage = options.storage || new Map();
    const { context } = harness([{ status: 'success', receipts }], {
        document: { getElementById: () => button },
        ethers: {
            Interface: class { encodeFunctionData() { return '0x1234'; } },
            BrowserProvider: class {},
            Contract: class { async quoteSaveLeaderboardWei() { return 123n; } },
        },
        localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
        BUILDER_CODE_SUFFIX: '0x00', PAYMENTS_ABI: [], PAYMENTS_CONTRACT: '0xcontract', PAYMASTER_URL: '',
        walletAddress: '0xplayer', walletReady: true, authToken: 'token',
        lastFinalScoreForRecord: 200, score: 200, rawScore: 200, pendingSubmitPromise: null,
        lastSubmitResult: {ok: true, finalScore: 200},
        submitBackendRun: async () => {throw new Error('Score sync failed');},
        gameConfig: { saveLeaderboardPriceWei: '100' }, BACKEND_URL: 'https://backend.test',
        extractCallsId: (raw) => raw.id,
        console: {error() {}, warn() {}},
        fetch: async (url, request) => {
            requests.push({ url, body: JSON.parse(request.body) });
            if (options.failSave && url.endsWith('/save')) throw new Error('Network lost');
            return { json: async () => ({ ok: true, paymentsContract: '0xcontract' }) };
        },
    });
    let payments = 0;
    context.window.__walletBridge.sendCalls = async (params) => {
        assert.equal(params.calls[0].value, 123n); // refreshed quote, not the stale config
        payments++; return { id: callsId };
    };
    vm.runInContext(saveCode, context);
    return {context, button, requests, storage, payments: () => payments};
}

test('Save sends the real receipt hash after syncing and preflighting the score', async () => {
    const {context, button, requests, payments} = saveHarness();
    await context.handleSaveRecord();
    assert.equal(payments(), 1);
    assert.deepEqual(requests.at(-1), {
        url: 'https://backend.test/api/leaderboard/save',
        body: { score: 200, txHash },
    });
    assert.equal(button.textContent, 'Saved ✓');
});

test('failed Save resumes the same payment after both a click retry and a page reload', async () => {
    const first = saveHarness({failSave: true});
    await first.context.handleSaveRecord();
    await first.context.handleSaveRecord();
    assert.equal(first.payments(), 1);
    assert.equal(first.storage.size, 1);
    const reloaded = saveHarness({storage: first.storage});
    await reloaded.context.handleSaveRecord();
    assert.equal(reloaded.payments(), 0);
    assert.equal(reloaded.requests.length, 1);
    assert.equal(reloaded.requests[0].body.txHash, txHash);
    assert.equal(reloaded.storage.size, 0);
});

test('failed score sync prevents payment', async () => {
    const h = saveHarness();
    h.context.lastSubmitResult = null;
    await h.context.handleSaveRecord();
    assert.equal(h.payments(), 0);
    assert.equal(h.requests.length, 0);
    assert.match(h.button.textContent, /Score sync failed/);
});

test('unconfirmed batch resumes polling without sending another wallet call', async () => {
    const h = saveHarness();
    h.storage.set(h.context.paymentKey('saveLeaderboard'), JSON.stringify({args: [200], callsId, transport: 'bridge'}));
    await h.context.handleSaveRecord();
    assert.equal(h.payments(), 0);
    assert.equal(h.requests.at(-1).body.txHash, txHash);
});

test('unknown wallet submission status never automatically pays again', async () => {
    const h = saveHarness();
    h.storage.set(h.context.paymentKey('saveLeaderboard'), JSON.stringify({args: [200], stage: 'requesting'}));
    await h.context.handleSaveRecord();
    assert.equal(h.payments(), 0);
    assert.match(h.button.textContent, /status is unknown/);
});

test('saving an already registered record does not charge', async () => {
    const h = saveHarness();
    h.context.fetch = async () => ({json: async () => ({ok: true, alreadySaved: true, paymentsContract: '0xcontract'})});
    await h.context.handleSaveRecord();
    assert.equal(h.payments(), 0);
    assert.equal(h.button.textContent, 'Saved ✓');
});
