'use strict';

/*
 * Contract source: nest-payment-gateway apps/api-gateway/src/bank-connect/transfers/
 * bank-connect-transfer-api.controller.ts, bank-connect-transfer-gateway.service.ts,
 * dtos/bank-connect-transfer.dto.ts, mappers/bank-connect-transfer.mapper.ts;
 * apps/bank-connect-service/src/transfers/transfer.types.ts and transfer-events.ts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LunixiClient,
  BankTransferClient,
  BankFxClient,
  BankTransferStatus,
  BankTransferRail,
  BankTransferInitiatedVia,
  BankFxOrderStatus,
  BankFxRequestedSide,
  BankTransferEvents,
  BANK_TRANSFER_EVENT_PATTERN,
  BANK_TRANSFER_ROUTES,
  ConfigurationError,
  ApiError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const CONNECTION_ID = '1c0e3a5f-2d4b-4f6a-8b8c-3d5e7f9a1b2c';
const ACCOUNT_ID = '2d1f4b6a-3e5c-4a7b-9c9d-4e6f8a0b2c3d';
const USD_ACCOUNT_ID = '3e2a5c7b-4f6d-4b8c-8dae-5f7a9b1c3d4e';
const TRANSFER_ID = '5a4c7e9d-6b8f-4dae-8fc0-7b9c1d3e5f60';
const QUOTE_ID = '6b5d8fae-7c9a-4ebf-90d1-8cad2e4f6a71';
const ORDER_ID = '7c6e9abf-8dab-4fc0-81e2-9dbe3f5a7b82';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => JSON.stringify(body) };
}

function envelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', data, requestId: 'req_1', ...extra };
}

function page(items) {
  return envelope({ items }, { pageInfo: { hasMore: false, nextCursor: null, totalCount: null } });
}

/** SignatureGuard: canonical METHOD, path+query, X-Date, X-Nonce and Digest over the body as sent. */
function signatureGuardVerdict(call, publicKey) {
  const h = call.headers;
  if (!h['X-Key-Id'] || !h['X-Date'] || !h['X-Nonce'] || !h['X-Signature']) return 'AUTH_HEADERS_MISSING';
  const lines = [call.method.toUpperCase(), call.url.slice(BASE_URL.length), `X-Date:${h['X-Date']}`, `X-Nonce:${h['X-Nonce']}`];
  if (call.body !== null && call.body !== undefined) {
    const digest = `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(JSON.parse(call.body))).digest('base64')}`;
    if (h.Digest !== digest) return 'INVALID_DIGEST';
  }
  if (h.Digest) lines.push(`Digest:${h.Digest}`);
  const ok = crypto.verify(null, Buffer.from(lines.join('\n')), publicKey, Buffer.from(h['X-Signature'], 'base64'));
  return ok ? 'OK' : 'INVALID_SIGNATURE';
}

function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const publicKey = crypto.createPublicKey(keys.publicKey);
  const calls = [];
  const fetch = async (url, options = {}) => {
    const call = { url: String(url), ...options };
    if (call.url === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at_test_1', expires_in: 1800 });
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_test_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 0 });
  return { transfers: client.bankConnect.transfers, fx: client.bankConnect.fx, calls, publicKey };
}

const transferJson = (overrides = {}) => ({
  id: TRANSFER_ID, connectionId: CONNECTION_ID, accountId: ACCOUNT_ID, environment: 'test', status: 'SUBMITTED', rail: null,
  amountMinor: 150075, currency: 'TRY', sourceIbanMasked: 'TR00 **** **** **** **** **00 00',
  receiverIbanMasked: 'TR00 **** **** **** **** **01 46', receiverNameMasked: 'Ö**** T*******', receiverBankCode: '0062',
  paymentPurpose: null, description: 'Fatura 2026-0042', idempotencyKey: 'payout-2026-0042', failureCode: null,
  outcomeUnknown: false, initiatedVia: 'API', sanctionStatus: 'NOT_SCREENED', bankTransactionId: null, bankState: null,
  createdAt: '2026-01-01T07:00:00.000Z', submittedAt: '2026-01-01T07:00:00.000Z', completedAt: null, failedAt: null,
  returnedAt: null, canceledAt: null, otpExpiresAt: null, ...overrides,
});

const transferRequest = (overrides = {}) => ({
  accountId: ACCOUNT_ID, receiverIban: 'TR050006200000000000000146', receiverName: 'Örnek Tedarik A.Ş.',
  amountMinor: 150075, description: 'Fatura 2026-0042', ...overrides,
});

test('client.bankConnect carries the transfer and exchange sub-clients', () => {
  const { transfers, fx } = makeClient(() => jsonResponse(200, page([])));
  assert.ok(transfers instanceof BankTransferClient);
  assert.ok(fx instanceof BankFxClient);
});

test('every transfer and exchange call is signed, follows BANK_TRANSFER_ROUTES and sends a key only where required', async () => {
  const { transfers, fx, calls, publicKey } = makeClient((call) => (call.method === 'POST'
    ? jsonResponse(201, envelope({ transfer: transferJson(), order: { id: ORDER_ID }, stepUp: null, replayed: false, id: QUOTE_ID }))
    : jsonResponse(200, /\/(transfers|fx\/orders)(\?|$)/.test(call.url) ? page([]) : envelope({ items: [] }))));
  const drain = async (iterator) => { for await (const row of iterator) void row; };
  const invocations = {
    'transfers.listPurposes': ['listTransferPurposes', () => transfers.listPurposes(CONNECTION_ID)],
    'transfers.create': ['createTransfer', () => transfers.create(transferRequest())],
    'transfers.list': ['listTransfers', () => transfers.list()],
    'transfers.iterate': ['listTransfers', () => drain(transfers.iterate())],
    'transfers.get': ['getTransfer', () => transfers.get(TRANSFER_ID)],
    'fx.listRates': ['listFxRates', () => fx.listRates(CONNECTION_ID)],
    'fx.createQuote': ['createFxQuote', () => fx.createQuote({ sourceAccountId: ACCOUNT_ID, targetAccountId: USD_ACCOUNT_ID, targetAmountMinor: 100000 })],
    'fx.createOrder': ['createFxOrder', () => fx.createOrder({ quoteId: QUOTE_ID })],
    'fx.listOrders': ['listFxOrders', () => fx.listOrders()],
    'fx.iterateOrders': ['listFxOrders', () => drain(fx.iterateOrders())],
    'fx.getOrder': ['getFxOrder', () => fx.getOrder(ORDER_ID)],
  };

  const surface = [
    ...Object.getOwnPropertyNames(BankTransferClient.prototype).filter((n) => n !== 'constructor').map((n) => `transfers.${n}`),
    ...Object.getOwnPropertyNames(BankFxClient.prototype).filter((n) => n !== 'constructor').map((n) => `fx.${n}`),
  ];
  assert.deepEqual(surface.sort(), Object.keys(invocations).sort(), 'the lock covers the whole public surface');
  assert.deepEqual([...new Set(Object.values(invocations).map(([route]) => route))].sort(), Object.keys(BANK_TRANSFER_ROUTES).sort());

  for (const [name, [routeName, invoke]] of Object.entries(invocations)) {
    const route = BANK_TRANSFER_ROUTES[routeName];
    const before = calls.length;
    await invoke();
    assert.equal(calls.length, before + 1, `${name} sent one request`);
    const call = calls[calls.length - 1];
    const pattern = new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
    assert.equal(call.method, route.method, name);
    assert.match(call.url.slice(BASE_URL.length).split('?')[0], pattern, name);
    assert.equal(signatureGuardVerdict(call, publicKey), 'OK', `${name} must carry a valid API-key signature`);
    if (route.idempotencyKey) assert.match(call.headers['Idempotency-Key'], /^[\x21-\x7E]{8,200}$/, `${name} sends an Idempotency-Key`);
    else assert.equal(call.headers['Idempotency-Key'], undefined, `${name} sends no Idempotency-Key`);
    if (route.method === 'GET') assert.equal(call.body, null, `${name} sends no body`);
  }
});

test('create() sends the whitelisted body, generates a UUID key and keeps a caller key', async () => {
  const created = { transfer: transferJson(), stepUp: null, replayed: false };
  const { transfers, calls } = makeClient(() => jsonResponse(201, envelope(created)));
  assert.deepEqual(await transfers.create(transferRequest({ currency: 'try', paymentPurpose: undefined })), created);
  const first = calls[0];
  assert.deepEqual(JSON.parse(first.body), {
    accountId: ACCOUNT_ID, receiverIban: 'TR050006200000000000000146', receiverName: 'Örnek Tedarik A.Ş.',
    amountMinor: 150075, description: 'Fatura 2026-0042', currency: 'TRY',
  });
  assert.match(first.headers['Idempotency-Key'], UUID_V4);

  await transfers.create(transferRequest(), 'payout-2026-0042');
  assert.equal(calls[1].headers['Idempotency-Key'], 'payout-2026-0042');
});

test('a 5xx on create() is retried with the same Idempotency-Key', async () => {
  let attempt = 0;
  const keys = LunixiClient.generateKeyPair();
  const seen = [];
  const fetch = async (url, options = {}) => {
    if (String(url) === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at_test_1', expires_in: 1800 });
    seen.push(options.headers['Idempotency-Key']);
    attempt += 1;
    return attempt === 1 ? jsonResponse(503, { code: 'SERVICE_UNAVAILABLE', message: 'retry' }) : jsonResponse(201, envelope({ transfer: transferJson(), stepUp: null, replayed: false }));
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_test_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 1 });
  await client.bankConnect.transfers.create(transferRequest());
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], 'the generated key is reused on the retry');
});

test('invalid requests fail before anything is sent', async () => {
  const { transfers, fx, calls } = makeClient(() => jsonResponse(201, envelope({})));
  const cases = [
    [() => transfers.create(transferRequest({ environment: 'test' })), /does not accept environment/],
    [() => transfers.create(transferRequest({ receiverName: '' })), /requires receiverName/],
    [() => transfers.create(transferRequest({ amountMinor: 1500.75 })), /positive integer/],
    [() => transfers.create(transferRequest({ amountMinor: '150075' })), /positive integer/],
    [() => transfers.create(transferRequest({ receiverName: 'A' })), /2-140/],
    [() => transfers.create(transferRequest({ description: 'a'.repeat(141) })), /140/],
    [() => transfers.create(transferRequest({ paymentPurpose: 'kira ödemesi' })), /paymentPurpose/],
    [() => transfers.create(transferRequest({ currency: 'TL' })), /ISO 4217/],
    [() => transfers.create(transferRequest(), 'short'), /idempotencyKey/],
    [() => transfers.create(transferRequest(), 'payout 2026 0042'), /idempotencyKey/],
    [() => fx.createQuote({ sourceAccountId: ACCOUNT_ID, targetAccountId: USD_ACCOUNT_ID, sourceAmountMinor: 1, targetAmountMinor: 1 }), /exactly one/],
    [() => fx.createQuote({ sourceAccountId: ACCOUNT_ID, targetAccountId: USD_ACCOUNT_ID }), /exactly one/],
    [() => fx.createQuote({ sourceAccountId: ACCOUNT_ID, targetAccountId: ACCOUNT_ID, sourceAmountMinor: 1 }), /two different accounts/],
    [() => fx.createOrder({}), /requires quoteId/],
    [() => fx.createOrder({ quoteId: QUOTE_ID, fxSessionId: QUOTE_ID }), /does not accept fxSessionId/],
    [() => transfers.list({ environment: 'test' }), /Unknown filter/],
    [() => transfers.list({ status: 'DONE' }), /'status' must be one of/],
    [() => fx.listOrders({ status: BankTransferStatus.RETURNED }), /'status' must be one of/],
    [() => transfers.list({ limit: 101 }), /'limit'/],
    [() => transfers.get(' '), /transferId/],
  ];
  for (const [invoke, message] of cases) {
    await assert.rejects(invoke, (error) => error instanceof ConfigurationError && message.test(error.message), String(message));
  }
  assert.equal(calls.length, 0, 'nothing was sent');
});

test('list filters are sent the way the gateway parses them', async () => {
  const { transfers, fx, calls } = makeClient(() => jsonResponse(200, page([])));
  await transfers.list({
    accountId: ACCOUNT_ID, status: [BankTransferStatus.COMPLETED, BankTransferStatus.RETURNED],
    createdFrom: new Date('2026-01-01T00:00:00Z'), limit: 50,
  });
  assert.deepEqual(Object.fromEntries(new URL(calls[0].url).searchParams), {
    limit: '50', accountId: ACCOUNT_ID, status: 'COMPLETED,RETURNED', createdFrom: '2026-01-01T00:00:00.000Z',
  });
  await fx.listOrders({ status: BankFxOrderStatus.FAILED });
  assert.deepEqual(Object.fromEntries(new URL(calls[1].url).searchParams), { status: 'FAILED' });
  await fx.listRates(CONNECTION_ID);
  assert.equal(new URL(calls[2].url).search, `?connectionId=${CONNECTION_ID}`);
});

test('quote and order answers are the gateway JSON as is; an IP refusal keeps its code', async () => {
  const quote = {
    id: QUOTE_ID, connectionId: CONNECTION_ID, sourceAccountId: ACCOUNT_ID, targetAccountId: USD_ACCOUNT_ID, sourceCurrency: 'TRY',
    targetCurrency: 'USD', sourceAmountMinor: 3412500, targetAmountMinor: 100000, requestedSide: 'TARGET', appliedRate: '34.1250',
    taxAmountMinor: null, expiresAt: '2026-01-01T07:01:20.000Z', validForSeconds: 80, insufficientBalance: false,
    belowMinimum: false, createdAt: '2026-01-01T07:00:00.000Z',
  };
  const answers = [jsonResponse(201, envelope(quote)), jsonResponse(403, { code: 'bank_connect.auth.ip_not_allowed', message: 'Request from this IP is not allowed for this API key.' })];
  const { fx, transfers } = makeClient(() => answers.shift());
  assert.deepEqual(await fx.createQuote({ sourceAccountId: ACCOUNT_ID, targetAccountId: USD_ACCOUNT_ID, targetAmountMinor: 100000 }), quote);
  await assert.rejects(() => transfers.create(transferRequest()), (error) => error instanceof ApiError && error.statusCode === 403 && error.code === 'bank_connect.auth.ip_not_allowed');
});

test('value sets match the gateway', () => {
  assert.deepEqual(Object.values(BankTransferStatus), ['PENDING_OTP', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETURNED', 'CANCELED']);
  assert.deepEqual(Object.values(BankTransferRail), ['INTERNAL', 'INTRABANK', 'FAST', 'EFT', 'UNKNOWN']);
  assert.deepEqual(Object.values(BankTransferInitiatedVia), ['PANEL', 'API']);
  assert.deepEqual(Object.values(BankFxOrderStatus), ['SUBMITTED', 'COMPLETED', 'FAILED']);
  assert.deepEqual(Object.values(BankFxRequestedSide), ['SOURCE', 'TARGET']);
  assert.deepEqual(Object.values(BankTransferEvents), ['bank_transfer.created', 'bank_transfer.completed', 'bank_transfer.failed', 'bank_transfer.returned']);
  assert.equal(BANK_TRANSFER_EVENT_PATTERN, 'bank_transfer.*');
});

test('BANK_TRANSFER_ROUTES mirrors the gateway controller and DTOs', () => {
  // bank-connect-transfer-api.controller.ts (routes, Idempotency-Key) + dtos/bank-connect-transfer.dto.ts
  // (Api* DTOs: no environment, no fxSessionId; CursorPageQueryDto limit/cursor).
  assert.deepEqual(JSON.parse(JSON.stringify(BANK_TRANSFER_ROUTES)), {
    listTransferPurposes: { method: 'GET', path: '/api/v1/bank-connect/transfer-purposes', idempotencyKey: false, query: ['connectionId'] },
    createTransfer: {
      method: 'POST', path: '/api/v1/bank-connect/transfers', idempotencyKey: true,
      required: ['accountId', 'receiverIban', 'receiverName', 'amountMinor'], optional: ['currency', 'paymentPurpose', 'description'],
    },
    listTransfers: {
      method: 'GET', path: '/api/v1/bank-connect/transfers', idempotencyKey: false,
      query: ['limit', 'cursor', 'accountId', 'status', 'createdFrom', 'createdTo'],
    },
    getTransfer: { method: 'GET', path: '/api/v1/bank-connect/transfers/:transferId', idempotencyKey: false },
    listFxRates: { method: 'GET', path: '/api/v1/bank-connect/fx/rates', idempotencyKey: false, query: ['connectionId'] },
    createFxQuote: {
      method: 'POST', path: '/api/v1/bank-connect/fx/quotes', idempotencyKey: false,
      required: ['sourceAccountId', 'targetAccountId'], optional: ['sourceAmountMinor', 'targetAmountMinor'],
    },
    createFxOrder: { method: 'POST', path: '/api/v1/bank-connect/fx/orders', idempotencyKey: true, required: ['quoteId'], optional: ['description'] },
    listFxOrders: { method: 'GET', path: '/api/v1/bank-connect/fx/orders', idempotencyKey: false, query: ['limit', 'cursor', 'status'] },
    getFxOrder: { method: 'GET', path: '/api/v1/bank-connect/fx/orders/:orderId', idempotencyKey: false },
  });
});
