'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LunixiClient,
  WalletClient,
  WALLET_ROUTES,
  WalletQrType,
  ConfigurationError,
  ApiError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const ID = {
  program: '10000000-0000-4000-8000-000000000001',
  endUser: '20000000-0000-4000-8000-000000000002',
  wallet: '30000000-0000-4000-8000-000000000003',
  account: '40000000-0000-4000-8000-000000000004',
  operation: '50000000-0000-4000-8000-000000000005',
  corporate: '60000000-0000-4000-8000-000000000006',
  qr: '70000000-0000-4000-8000-000000000007',
  batch: '80000000-0000-4000-8000-000000000008',
  agent: '90000000-0000-4000-8000-000000000009',
  business: 'a0000000-0000-4000-8000-00000000000a',
};
const HEX = 'a'.repeat(64);
const NONCE = 'b'.repeat(64);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    text: async () => JSON.stringify(body),
  };
}

function successEnvelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', message: 'OK', data, statusCode: 200, requestId: 'req-1', ...extra };
}

function binaryResponse(bytes, contentType) {
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', contentType]]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString('latin1'),
  };
}

/**
 * Verifies a request the way the gateway's SignatureGuard does
 * (nest-payment-gateway apps/api-gateway/src/auth/guards/signature.guard.ts):
 * the Digest is SHA-256 over JSON.stringify of the PARSED body and the
 * canonical string is METHOD, request target (path + query), X-Date, X-Nonce
 * and Digest when present.
 */
function signatureGuardVerdict(call, publicKey) {
  const h = call.headers;
  if (!h['X-Key-Id'] || !h['X-Date'] || !h['X-Nonce'] || !h['X-Signature']) return 'AUTH_HEADERS_MISSING';
  if (Math.abs(Date.now() - new Date(h['X-Date']).getTime()) > 300000) return 'INVALID_DATE';
  const body = call.body ? JSON.parse(call.body) : undefined;
  if (body && Object.keys(body).length > 0) {
    if (!h.Digest) return 'DIGEST_MISSING';
    const expected = 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
    if (h.Digest !== expected) return 'INVALID_DIGEST';
  }
  const target = call.url.slice(BASE_URL.length);
  const lines = [call.method.toUpperCase(), target, `X-Date:${h['X-Date']}`, `X-Nonce:${h['X-Nonce']}`];
  if (h.Digest) lines.push(`Digest:${h.Digest}`);
  const ok = crypto.verify(null, Buffer.from(lines.join('\n')), publicKey, Buffer.from(h['X-Signature'], 'base64'));
  return ok ? 'OK' : 'INVALID_SIGNATURE';
}

function makeClient(responder = () => jsonResponse(200, successEnvelope({ items: [], nextCursor: null }))) {
  const keys = LunixiClient.generateKeyPair();
  const publicKey = crypto.createPublicKey(keys.publicKey);
  const calls = [];
  const fetch = async (url, options = {}) => {
    const call = { url: String(url), ...options };
    if (call.url === BASE_URL + TOKEN_PATH) {
      return jsonResponse(200, { access_token: 'at_test', expires_in: 1800 });
    }
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_test_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 0 });
  return { client, calls, publicKey };
}

/** The route a request hit, by method and path template. */
function routeOf(call) {
  const path = new URL(call.url).pathname;
  const hits = Object.entries(WALLET_ROUTES).filter(([, route]) => {
    if (route.method !== call.method) return false;
    const pattern = new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
    return pattern.test(path);
  }).map(([name]) => name);
  // `/end-users/by-external/:x` also matches `/end-users/:id/...`-shaped templates only by length; take the most literal.
  hits.sort((a, b) => WALLET_ROUTES[b].path.replace(/:[A-Za-z]+/g, '').length - WALLET_ROUTES[a].path.replace(/:[A-Za-z]+/g, '').length);
  return hits[0];
}

const W2W = { endUserId: ID.endUser, sourceWalletAccountId: ID.account, destinationWalletNo: '1234567890', amount: '12550', currency: 'TRY' };
const IBAN = { endUserId: ID.endUser, sourceWalletAccountId: ID.account, beneficiaryName: 'Ayşe Yılmaz', iban: 'TR330006100519786457841326', amount: '50000', currency: 'TRY' };
const COMPLETE = { endUserId: ID.endUser, integrityHash: HEX, nonce: NONCE, otpCode: '123456' };

/** One valid call for every public method of every wallet sub-client. */
const INVOCATIONS = {
  'ping': (w) => w.ping(),
  'programs.listMine': (w) => w.programs.listMine(),
  'programs.setCollectionAnchor': (w) => w.programs.setCollectionAnchor(ID.program, { collectionEndUserId: ID.endUser, reason: 'collection wallet' }),
  'endUsers.create': (w) => w.endUsers.create({ programId: ID.program, accountType: 'PERSONAL', phone: '+905301234567', externalCustomerId: 'cust-1' }, 'eu-create-1'),
  'endUsers.list': (w) => w.endUsers.list({ programId: ID.program, limit: 20 }),
  'endUsers.iterate': async (w) => { for await (const item of w.endUsers.iterate({ limit: 1 })) void item; },
  'endUsers.get': (w) => w.endUsers.get(ID.endUser),
  'endUsers.getByExternalId': (w) => w.endUsers.getByExternalId('cust-1', ID.program),
  'endUsers.freeze': (w) => w.endUsers.freeze(ID.endUser, { reason: 'fraud review' }, 'eu-freeze-1'),
  'endUsers.getBalances': (w) => w.endUsers.getBalances(ID.endUser),
  'endUsers.getKycLevel': (w) => w.endUsers.getKycLevel(ID.endUser),
  'endUsers.updateKycLevel': (w) => w.endUsers.updateKycLevel(ID.endUser, { kycLevel: 'LOW', sourceRef: 'kyc-session-1' }, 'eu-kyc-1'),
  'endUsers.getLimits': (w) => w.endUsers.getLimits(ID.endUser, { operationType: 'W2W', currency: 'TRY' }),
  'endUsers.createWallet': (w) => w.endUsers.createWallet(ID.endUser, { name: 'Savings', currencies: ['TRY'] }, 'eu-wallet-1'),
  'wallets.createAccount': (w) => w.wallets.createAccount(ID.wallet, 'USD', 'wa-create-1'),
  'wallets.lookup': (w) => w.wallets.lookup({ walletNo: '1234567890' }),
  'deposits.listInstructions': (w) => w.deposits.listInstructions(ID.endUser),
  'deposits.createInstruction': (w) => w.deposits.createInstruction(ID.endUser, { walletAccountId: ID.account, currency: 'TRY' }),
  'deposits.simulateInboundCredit': (w) => w.deposits.simulateInboundCredit({ programId: ID.program, railId: 'TESTBANK', amount: '10000', currency: 'TRY', rawReference: 'LNX-8F3K2A' }),
  'corporate.create': (w) => w.corporate.create({ programId: ID.program, code: 'ACME', name: 'Acme Ltd', ownerEndUserId: ID.endUser }, 'corp-create-1'),
  'corporate.list': (w) => w.corporate.list({ status: 'ACTIVE' }),
  'corporate.iterate': async (w) => { for await (const item of w.corporate.iterate()) void item; },
  'corporate.importEmployees': (w) => w.corporate.importEmployees(ID.corporate, [{ phone: '+905301234568', displayName: 'Mehmet' }], 'corp-import-1'),
  'corporate.offboardEmployees': (w) => w.corporate.offboardEmployees(ID.corporate, [{ externalCustomerId: 'emp-7' }], { reason: 'left' }, 'corp-off-1'),
  'fees.quote': (w) => w.fees.quote({ programId: ID.program, operationType: 'W2W', currency: 'TRY', amount: '12550' }),
  'transfers.quoteW2W': (w) => w.transfers.quoteW2W(W2W),
  'transfers.initiateW2W': (w) => w.transfers.initiateW2W({ ...W2W, otpChannel: 'SMS' }, 'w2w-init-1'),
  'transfers.completeW2W': (w) => w.transfers.completeW2W(ID.operation, COMPLETE, 'w2w-complete-1'),
  'transfers.quoteW2Iban': (w) => w.transfers.quoteW2Iban(IBAN),
  'transfers.initiateW2Iban': (w) => w.transfers.initiateW2Iban(IBAN, 'w2iban-init-1'),
  'transfers.completeW2Iban': (w) => w.transfers.completeW2Iban(ID.operation, COMPLETE, 'w2iban-complete-1'),
  'withdrawals.quote': (w) => w.withdrawals.quote(IBAN),
  'withdrawals.initiate': (w) => w.withdrawals.initiate(IBAN, 'wd-init-1'),
  'withdrawals.complete': (w) => w.withdrawals.complete(ID.operation, COMPLETE, 'wd-complete-1'),
  'withdrawals.get': (w) => w.withdrawals.get(ID.operation),
  'operations.list': (w) => w.operations.list({ endUserId: ID.endUser, limit: 50 }),
  'operations.iterate': async (w) => { for await (const item of w.operations.iterate({ endUserId: ID.endUser })) void item; },
  'operations.get': (w) => w.operations.get(ID.operation),
  'operations.getReceipt': (w) => w.operations.getReceipt(ID.operation),
  'topups.startCard': (w) => w.topups.startCard({ creditWalletAccountId: ID.account, amount: '25000', currency: 'TRY', returnUrl: 'https://merchant.example/return' }, 'topup-1'),
  'topups.get': (w) => w.topups.get(ID.operation),
  'topups.refund': (w) => w.topups.refund(ID.operation, { reason: 'customer request', requesterPrincipal: 'ops-1', approverPrincipal: 'ops-2' }),
  'topups.agent': (w) => w.topups.agent({ agentId: ID.agent, creditWalletAccountId: ID.account, amount: '10000', currency: 'TRY' }, 'agent-topup-1'),
  'payments.request': (w) => w.payments.request({ buyerWalletNo: '1234567890', amount: '4990', currency: 'TRY', paymentPurpose: 'ORDER', orderRef: 'ord-1' }, 'pay-req-1'),
  'payments.approve': (w) => w.payments.approve(ID.operation, { buyerEndUserId: ID.endUser, integrityHash: HEX, nonce: NONCE }, 'pay-approve-1'),
  'payments.collect': (w) => w.payments.collect({ code: 'CPM123456', amount: '4990', currency: 'TRY' }, 'pay-collect-1'),
  'payments.get': (w) => w.payments.get(ID.operation),
  'payments.getCommission': (w) => w.payments.getCommission(ID.business),
  'qr.create': (w) => w.qr.create({ qrType: WalletQrType.MERCHANT_DYNAMIC, currency: 'TRY', amount: '4990', expiresInSeconds: 600, metadata: {} }, 'qr-create-1'),
  'qr.list': (w) => w.qr.list({ qrType: 'MERCHANT_STATIC' }),
  'qr.iterate': async (w) => { for await (const item of w.qr.iterate()) void item; },
  'qr.get': (w) => w.qr.get(ID.qr),
  'qr.image': (w) => w.qr.image(ID.qr, { format: 'svg', scale: 4 }),
  'qr.revoke': (w) => w.qr.revoke(ID.qr),
  'qr.parse': (w) => w.qr.parse('00020101021226...'),
  'bulkPayouts.create': (w) => w.bulkPayouts.create({ programId: ID.program, sourceWalletAccountId: ID.account, currency: 'TRY', items: [{ targetType: 'WALLET', targetRef: '1234567890', amount: '100000' }] }, 'bulk-create-1'),
  'bulkPayouts.list': (w) => w.bulkPayouts.list({ status: 'DRAFT' }),
  'bulkPayouts.get': (w) => w.bulkPayouts.get(ID.batch),
  'bulkPayouts.listItems': (w) => w.bulkPayouts.listItems(ID.batch, { limit: 500 }),
  'bulkPayouts.submit': (w) => w.bulkPayouts.submit(ID.batch),
  'bulkPayouts.approve': (w) => w.bulkPayouts.approve(ID.batch, { approve: true }),
  'bulkPayouts.reject': (w) => w.bulkPayouts.reject(ID.batch, { reason: 'wrong file' }),
  'bulkPayouts.process': (w) => w.bulkPayouts.process(ID.batch),
  'bulkPayouts.retryFailed': (w) => w.bulkPayouts.retryFailed(ID.batch),
};

/** Every public method of the wallet client and its sub-clients. */
function publicMethods(wallet) {
  const names = ['ping'];
  for (const [group, sub] of Object.entries(wallet)) {
    if (group === 'api') continue;
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(sub))) {
      if (name !== 'constructor' && typeof sub[name] === 'function') names.push(`${group}.${name}`);
    }
  }
  return names.sort();
}

function walletResponder(call) {
  if (call.url.includes('/image')) return binaryResponse(SVG, 'image/svg+xml');
  return jsonResponse(200, successEnvelope({ items: [], nextCursor: null }));
}

test('every wallet method is covered by this test (a new method fails until it is listed and signed)', () => {
  const { client } = makeClient();
  assert.ok(client.wallet instanceof WalletClient);
  assert.deepEqual(publicMethods(client.wallet), Object.keys(INVOCATIONS).sort());
});

test('every wallet call is signed the way SignatureGuard verifies it', async () => {
  const { client, calls, publicKey } = makeClient(walletResponder);
  for (const [name, invoke] of Object.entries(INVOCATIONS)) {
    const before = calls.length;
    await invoke(client.wallet);
    assert.ok(calls.length > before, `${name} sent no request`);
    for (const call of calls.slice(before)) {
      assert.equal(signatureGuardVerdict(call, publicKey), 'OK', `${name} → ${call.method} ${call.url}`);
    }
  }
});

test('the methods reach all 60 wallet routes, each with the gateway\'s Idempotency-Key rule', async () => {
  const { client, calls } = makeClient(walletResponder);
  for (const invoke of Object.values(INVOCATIONS)) await invoke(client.wallet);
  const hit = new Set();
  for (const call of calls) {
    const name = routeOf(call);
    assert.ok(name, `no route matches ${call.method} ${call.url}`);
    hit.add(name);
    const hasKey = Boolean(call.headers['Idempotency-Key']);
    assert.equal(hasKey, WALLET_ROUTES[name].idempotencyKey, `${name}: Idempotency-Key ${hasKey ? 'sent' : 'missing'}`);
  }
  assert.equal(Object.keys(WALLET_ROUTES).length, 60);
  assert.deepEqual([...hit].sort(), Object.keys(WALLET_ROUTES).sort());
});

test('bodies carry only the fields the gateway DTO accepts (forbidNonWhitelisted)', async () => {
  const { client, calls } = makeClient(walletResponder);
  for (const invoke of Object.values(INVOCATIONS)) await invoke(client.wallet);
  for (const call of calls) {
    const route = WALLET_ROUTES[routeOf(call)];
    if (!call.body) continue;
    const allowed = new Set([...(route.required || []), ...(route.optional || [])]);
    for (const key of Object.keys(JSON.parse(call.body))) assert.ok(allowed.has(key), `${route.path}: ${key}`);
  }
});

test('local validation fails before anything is sent', async () => {
  const { client, calls } = makeClient();
  const w = client.wallet;
  const cases = [
    [() => w.transfers.quoteW2W({ ...W2W, amount: 125.5 }), /minor units/],
    [() => w.transfers.quoteW2W({ ...W2W, amount: '125.50' }), /minor units/],
    [() => w.transfers.quoteW2W({ ...W2W, businessAccountId: ID.business }), /does not accept businessAccountId/],
    [() => w.transfers.quoteW2W({ sourceWalletAccountId: ID.account, amount: '1', currency: 'TRY' }), /requires endUserId/],
    [() => w.payments.approve(ID.operation, { integrityHash: HEX, nonce: NONCE }, 'k1'), /requires buyerEndUserId/],
    [() => w.topups.refund(ID.operation, { reason: 'customer request', requesterPrincipal: 'ops-1' }), /requires approverPrincipal/],
    [() => w.transfers.initiateW2W(W2W), /Idempotency-Key is required/],
    [() => w.transfers.initiateW2W(W2W, '   '), /Idempotency-Key is required/],
    [() => w.transfers.initiateW2W(W2W, 'k'.repeat(129)), /1-128/],
    [() => w.endUsers.get(''), /endUserId is required/],
    [() => w.endUsers.list({ phone: '+90' }), /does not accept the filter/],
    [() => w.bulkPayouts.create({ programId: ID.program, sourceWalletAccountId: ID.account, currency: 'TRY', items: [] }, 'k'), /non-empty array/],
    [() => w.bulkPayouts.create({ programId: ID.program, sourceWalletAccountId: ID.account, currency: 'TRY', items: [{ targetType: 'IBAN', targetRef: 'TR..', amount: 1.5 }] }, 'k'), /minor units/],
    [() => w.corporate.importEmployees(ID.corporate, [{ displayName: 'no phone' }], 'k'), /requires phone/],
    [() => w.qr.image(ID.qr, { format: 'jpg' }), /format/],
    [() => w.transfers.completeW2W(ID.operation, { ...COMPLETE, operationId: ID.endUser }, 'k'), /must match/],
  ];
  for (const [run, message] of cases) {
    await assert.rejects(run, (error) => error instanceof ConfigurationError && message.test(error.message), String(message));
  }
  assert.equal(calls.length, 0);
});

test('an integer amount is sent as its digit string; complete bodies carry the operation id', async () => {
  const { client, calls } = makeClient();
  await client.wallet.transfers.quoteW2W({ ...W2W, amount: 12550 });
  await client.wallet.transfers.completeW2W(ID.operation, COMPLETE, 'k1');
  assert.equal(JSON.parse(calls[0].body).amount, '12550');
  assert.equal(JSON.parse(calls[1].body).operationId, ID.operation);
  assert.ok(calls[1].url.endsWith(`/transfers/w2w/${ID.operation}/complete`));
});

test('lists read both wallet list shapes and iterate follows the cursor', async () => {
  const pages = [
    successEnvelope({ operations: [{ id: 'op1' }], nextCursor: 'c2' }, { pageInfo: { hasMore: true, nextCursor: 'c2' } }),
    successEnvelope({ operations: [{ id: 'op2' }], nextCursor: null }),
  ];
  const { client, calls } = makeClient(() => jsonResponse(200, pages.shift()));
  const ids = [];
  for await (const op of client.wallet.operations.iterate({ endUserId: ID.endUser })) ids.push(op.id);
  assert.deepEqual(ids, ['op1', 'op2']);
  assert.ok(calls[1].url.includes('cursor=c2'));

  const { client: c2 } = makeClient(() => jsonResponse(200, successEnvelope({ items: [{ id: 'eu1' }], nextCursor: 'n' })));
  const page = await c2.wallet.endUsers.list();
  assert.deepEqual(page.items, [{ id: 'eu1' }]);
  assert.equal(page.nextCursor, 'n');
  assert.equal(page.hasMore, true);
});

test('QR image returns the bytes, not the envelope', async () => {
  const { client, calls } = makeClient(() => binaryResponse(SVG, 'image/svg+xml'));
  const image = await client.wallet.qr.image(ID.qr, { format: 'svg' });
  assert.equal(image.contentType, 'image/svg+xml');
  assert.ok(image.data.equals(SVG));
  assert.ok(calls[0].url.endsWith(`/qr/${ID.qr}/image?format=svg`));
});

test('gateway errors surface as ApiError with the wallet code', async () => {
  const { client } = makeClient(() => jsonResponse(403, { code: 'WALLET_INSUFFICIENT_SCOPE', message: 'missing scope' }, { 'x-request-id': 'r-9' }));
  await assert.rejects(
    () => client.wallet.transfers.initiateW2Iban(IBAN, 'k1'),
    (error) => error instanceof ApiError && error.statusCode === 403 && error.code === 'WALLET_INSUFFICIENT_SCOPE' && error.requestId === 'r-9',
  );
});
