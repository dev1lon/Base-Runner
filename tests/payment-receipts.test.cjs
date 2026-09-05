const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../script.js'), 'utf8');
const receiptCode = source.slice(source.indexOf('function confirmedCallsTxHash('), source.indexOf('async function waitForTransactionHash('));
const saveCode = source.slice(source.indexOf('async function sendPaymentsCall('), source.indexOf('function setWalletError('));
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

test('Save sends the real receipt hash to the backend after a viem success', async () => {
    const button = { disabled: false, textContent: '' };
    const requests = [];
    const { context } = harness([{ status: 'success', receipts }], {
        document: { getElementById: () => button },
        ethers: { Interface: class { encodeFunctionData() { return '0x1234'; } } },
        BUILDER_CODE_SUFFIX: '0x00', PAYMENTS_ABI: [], PAYMENTS_CONTRACT: '0xcontract', PAYMASTER_URL: '',
        walletAddress: '0xplayer', walletReady: true, authToken: 'token',
        lastFinalScoreForRecord: 200, score: 200, pendingSubmitPromise: null,
        gameConfig: { saveLeaderboardPriceWei: '100' }, BACKEND_URL: 'https://backend.test',
        extractCallsId: (raw) => raw.id,
        fetch: async (url, request) => {
            requests.push({ url, body: JSON.parse(request.body) });
            return { json: async () => ({ ok: true }) };
        },
    });
    let payments = 0;
    context.window.__walletBridge.sendCalls = async () => { payments++; return { id: callsId }; };
    vm.runInContext(saveCode, context);
    await context.handleSaveRecord();
    assert.equal(payments, 1);
    assert.deepEqual(requests, [{
        url: 'https://backend.test/api/leaderboard/save',
        body: { score: 200, txHash },
    }]);
    assert.equal(button.textContent, 'Saved ✓');
});
