'use strict';

/*
 * Contract source: nest-payment-gateway apps/api-gateway/src/bank-connect/api/
 * (controller, service), dtos/bank-connect-api.dto.ts,
 * mappers/bank-connect-api.mapper.ts; webhook payload
 * apps/bank-connect-service/src/sync/bank-account-webhook.ts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LunixiClient,
  BankConnectClient,
  WebhookVerifier,
  BankConnectionStatus,
  BankAccountStatus,
  BankTransactionDirection,
  BankTransactionType,
  BankAvailability,
  BankCapability,
  BankSyncStatus,
  BankConnectEvents,
  BANK_CONNECT_EVENT_PATTERN,
  BANK_CONNECT_FILTERS,
  ConfigurationError,
  ApiError,
  RateLimitError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const BANK_ID = '0b9d2f4e-1c3a-4e5f-9a7b-2c4d6e8f0a1b';
const CONNECTION_ID = '1c0e3a5f-2d4b-4f6a-8b8c-3d5e7f9a1b2c';
const ACCOUNT_ID = '2d1f4b6a-3e5c-4a7b-9c9d-4e6f8a0b2c3d';
const OTHER_ACCOUNT_ID = '3e2a5c7b-4f6d-4b8c-8dae-5f7a9b1c3d4e';
const TRANSACTION_ID = '4f3b6d8c-5a7e-4c9d-9ebf-6a8b0c2d4e5f';

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    text: async () => JSON.stringify(body),
  };
}

function envelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', data, requestId: 'req_1', ...extra };
}

/** List envelope: rows in `data.items`, paging in the top-level `pageInfo`. */
function page(items, hasMore = false, nextCursor = null) {
  return envelope({ items }, { pageInfo: { hasMore, nextCursor, totalCount: null } });
}

/** SignatureGuard (apps/api-gateway/src/auth/guards/signature.guard.ts) for body-less requests. */
function signatureGuardVerdict(call, publicKey) {
  const h = call.headers;
  if (!h['X-Key-Id'] || !h['X-Date'] || !h['X-Nonce'] || !h['X-Signature']) return 'AUTH_HEADERS_MISSING';
  if (Math.abs(Date.now() - new Date(h['X-Date']).getTime()) > 300000) return 'INVALID_DATE';
  const lines = [call.method.toUpperCase(), call.url.slice(BASE_URL.length), `X-Date:${h['X-Date']}`, `X-Nonce:${h['X-Nonce']}`];
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
  return { client, bank: client.bankConnect, calls, publicKey };
}

function target(call) {
  return call.url.slice(BASE_URL.length);
}

function queryOf(call) {
  return Object.fromEntries(new URL(call.url).searchParams.entries());
}

const bankRef = () => ({ bankId: BANK_ID, eftCode: '0000', name: 'ÖRNEK BANKA' });
const transactionJson = (overrides = {}) => ({
  transactionId: TRANSACTION_ID, accountId: ACCOUNT_ID, direction: 'CREDIT', amountMinor: 150000, currency: 'TRY',
  bookedAt: '2026-01-01T07:00:00.000Z', canonicalType: 'TRANSFER_IN', description: 'LNX-ORNEK-0001',
  counterpartyNameMasked: 'Ö**** A****', counterpartyIbanMasked: 'TR00 **** **** **** **** **00 00',
  receivedAt: '2026-01-01T07:05:00.000Z', ...overrides,
});

test('client.bankConnect is a BankConnectClient', () => {
  const { bank } = makeClient(() => jsonResponse(200, page([])));
  assert.ok(bank instanceof BankConnectClient);
});

test('every bank-connect call is signed and hits its route', async () => {
  const { bank, calls, publicKey } = makeClient((call) => (call.method === 'POST'
    ? jsonResponse(202, envelope({ accountId: ACCOUNT_ID, syncStatus: 'QUEUED', minSyncIntervalSeconds: 300 }))
    : jsonResponse(200, call.url.match(/\/(banks|connections|accounts|balances|transactions)(\?|$)/) ? page([]) : envelope({}))));
  const drain = async (iterator) => { for await (const row of iterator) void row; };
  const invocations = {
    listBanks: ['GET /api/v1/bank-connect/banks', () => bank.listBanks()],
    iterateBanks: ['GET /api/v1/bank-connect/banks', () => drain(bank.iterateBanks())],
    listConnections: ['GET /api/v1/bank-connect/connections', () => bank.listConnections()],
    iterateConnections: ['GET /api/v1/bank-connect/connections', () => drain(bank.iterateConnections())],
    getConnection: [`GET /api/v1/bank-connect/connections/${CONNECTION_ID}`, () => bank.getConnection(CONNECTION_ID)],
    listAccounts: ['GET /api/v1/bank-connect/accounts', () => bank.listAccounts()],
    iterateAccounts: ['GET /api/v1/bank-connect/accounts', () => drain(bank.iterateAccounts())],
    getAccount: [`GET /api/v1/bank-connect/accounts/${ACCOUNT_ID}`, () => bank.getAccount(ACCOUNT_ID)],
    requestSync: [`POST /api/v1/bank-connect/accounts/${ACCOUNT_ID}/sync`, () => bank.requestSync(ACCOUNT_ID)],
    listBalances: ['GET /api/v1/bank-connect/balances', () => bank.listBalances()],
    iterateBalances: ['GET /api/v1/bank-connect/balances', () => drain(bank.iterateBalances())],
    listTransactions: ['GET /api/v1/bank-connect/transactions', () => bank.listTransactions()],
    iterateTransactions: ['GET /api/v1/bank-connect/transactions', () => drain(bank.iterateTransactions())],
    getTransaction: [`GET /api/v1/bank-connect/transactions/${TRANSACTION_ID}`, () => bank.getTransaction(TRANSACTION_ID)],
  };

  // The lock covers the whole public surface: a method added later without an
  // entry above fails here instead of shipping unsigned.
  const methods = Object.getOwnPropertyNames(BankConnectClient.prototype).filter((name) => name !== 'constructor');
  assert.deepEqual([...methods].sort(), Object.keys(invocations).sort());

  for (const [name, [route, invoke]] of Object.entries(invocations)) {
    const before = calls.length;
    await invoke();
    assert.equal(calls.length, before + 1, `${name} sent one request`);
    const call = calls[calls.length - 1];
    assert.equal(`${call.method} ${target(call).split('?')[0]}`, route, name);
    assert.equal(signatureGuardVerdict(call, publicKey), 'OK', `${name} must carry a valid API-key signature`);
    assert.equal(call.body, null, `${name} sends no body`);
    assert.equal(call.headers['Idempotency-Key'], undefined, `${name} needs no Idempotency-Key`);
  }
});

test('the signature stand-in rejects an unsigned or retargeted call', async () => {
  const { bank, calls, publicKey } = makeClient(() => jsonResponse(200, page([])));
  await bank.listAccounts({ limit: 5 });
  const [call] = calls;
  const unsigned = { ...call, headers: { ...call.headers, 'X-Signature': undefined } };
  assert.equal(signatureGuardVerdict(unsigned, publicKey), 'AUTH_HEADERS_MISSING');
  assert.equal(signatureGuardVerdict({ ...call, url: `${BASE_URL}/api/v1/bank-connect/accounts?limit=6` }, publicKey), 'INVALID_SIGNATURE');
});

test('transaction filters are sent the way the gateway parses them', async () => {
  const { bank, calls, publicKey } = makeClient(() => jsonResponse(200, page([])));
  await bank.listTransactions({
    accountId: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
    bookedFrom: new Date('2025-12-31T21:00:00.000Z'),
    bookedTo: '2026-04-02T21:00:00Z',
    direction: BankTransactionDirection.CREDIT,
    minAmountMinor: 100,
    maxAmountMinor: 200,
    canonicalType: [BankTransactionType.TRANSFER_IN, BankTransactionType.FEE],
    limit: 50,
    cursor: 'opaque-cursor',
  });
  const [call] = calls;
  assert.equal(signatureGuardVerdict(call, publicKey), 'OK');
  assert.deepEqual(queryOf(call), {
    limit: '50',
    cursor: 'opaque-cursor',
    accountId: `${ACCOUNT_ID},${OTHER_ACCOUNT_ID}`,
    bookedFrom: '2025-12-31T21:00:00.000Z',
    bookedTo: '2026-04-02T21:00:00Z',
    direction: 'CREDIT',
    minAmountMinor: '100',
    maxAmountMinor: '200',
    canonicalType: 'TRANSFER_IN,FEE',
  });
  assert.match(call.url, /canonicalType=TRANSFER_IN%2CFEE/, 'the comma list is percent-encoded once and signed as sent');
});

test('a time-zone offset is percent-encoded and signed', async () => {
  const { bank, calls, publicKey } = makeClient(() => jsonResponse(200, page([])));
  await bank.listTransactions({ bookedFrom: '2026-03-01T00:00:00+03:00' });
  assert.match(calls[0].url, /bookedFrom=2026-03-01T00%3A00%3A00%2B03%3A00/);
  assert.equal(signatureGuardVerdict(calls[0], publicKey), 'OK');
});

test('filters of the other list routes', async () => {
  const { bank, calls } = makeClient(() => jsonResponse(200, page([])));
  await bank.listConnections({ status: [BankConnectionStatus.ACTIVE, BankConnectionStatus.DEGRADED], bankId: BANK_ID });
  await bank.listAccounts({ connectionId: CONNECTION_ID, currency: 'try', status: BankAccountStatus.ACTIVE });
  await bank.listBalances({ accountId: ACCOUNT_ID });
  assert.deepEqual(queryOf(calls[0]), { status: 'ACTIVE,DEGRADED', bankId: BANK_ID });
  assert.deepEqual(queryOf(calls[1]), { connectionId: CONNECTION_ID, currency: 'TRY', status: 'ACTIVE' });
  assert.deepEqual(queryOf(calls[2]), { accountId: ACCOUNT_ID });
});

test('empty filters send no query; exactly 92 days is accepted', async () => {
  const { bank, calls } = makeClient(() => jsonResponse(200, page([])));
  await bank.listTransactions({ accountId: [], direction: null, cursor: '' });
  assert.equal(target(calls[0]), '/api/v1/bank-connect/transactions');
  await bank.listTransactions({ bookedFrom: '2026-01-01T00:00:00Z', bookedTo: '2026-04-03T00:00:00Z' });
  assert.equal(calls.length, 2);
});

test('invalid filters fail before anything is sent', async () => {
  const cases = [
    ['listTransactions', { descriptionContains: 'LNX' }, /Unknown bank-connect filter/],
    ['listAccounts', { merchantId: 'org_1' }, /Unknown bank-connect filter/],
    ['listAccounts', { environment: 'live' }, /Unknown bank-connect filter/],
    ['listBanks', { includeTotal: true }, /Unknown bank-connect filter/],
    ['listBanks', { limit: 0 }, /'limit'/],
    ['listAccounts', { limit: 101 }, /'limit'/],
    ['listAccounts', { limit: '20' }, /'limit'/],
    ['listConnections', { status: 'OPEN' }, /'status'/],
    ['listAccounts', { status: ['ACTIVE'] }, /'status'/],
    ['listTransactions', { direction: 'IN' }, /'direction'/],
    ['listTransactions', { canonicalType: ['TRANSFER_IN', 'NOT_A_TYPE'] }, /'canonicalType'/],
    ['listBalances', { currency: 'TL' }, /'currency'/],
    ['listTransactions', { minAmountMinor: -1 }, /'minAmountMinor'/],
    ['listTransactions', { maxAmountMinor: 12.5 }, /'maxAmountMinor'/],
    ['listTransactions', { minAmountMinor: 500, maxAmountMinor: 100 }, /must not be greater/],
    ['listTransactions', { bookedTo: '2026-04-03T00:00:00Z' }, /'bookedTo' needs 'bookedFrom'/],
    ['listTransactions', { bookedFrom: '2026-04-03T00:00:00Z', bookedTo: '2026-04-01T00:00:00Z' }, /must not be after/],
    ['listTransactions', { bookedFrom: '2026-01-01T00:00:00Z', bookedTo: '2026-04-03T00:00:00.001Z' }, /at most 92 days/],
    ['listTransactions', { bookedFrom: new Date('invalid') }, /invalid Date/],
    ['listBalances', { accountId: Array(101).fill(ACCOUNT_ID) }, /at most 100/],
    ['listTransactions', { accountId: [`${ACCOUNT_ID},x`] }, /'accountId'/],
  ];
  const { bank, calls } = makeClient(() => jsonResponse(200, page([])));
  for (const [method, filters, message] of cases) {
    await assert.rejects(() => bank[method](filters), (error) => error instanceof ConfigurationError && message.test(error.message), `${method} ${JSON.stringify(filters)}`);
  }
  for (const method of ['getConnection', 'getAccount', 'getTransaction', 'requestSync']) {
    await assert.rejects(() => bank[method]('  '), ConfigurationError);
  }
  assert.equal(calls.length, 0);
});

test('BANK_CONNECT_FILTERS lists the query fields of the gateway DTOs', () => {
  // dtos/bank-connect-api.dto.ts: CursorPageQueryDto (limit, cursor; includeTotal is accepted but
  // never fills totalCount here, so it is not offered) + each DTO's own fields.
  assert.deepEqual(BANK_CONNECT_FILTERS, {
    listBanks: ['limit', 'cursor'],
    listConnections: ['limit', 'cursor', 'status', 'bankId'],
    listAccounts: ['limit', 'cursor', 'connectionId', 'bankId', 'currency', 'status'],
    listBalances: ['limit', 'cursor', 'accountId', 'currency'],
    listTransactions: ['limit', 'cursor', 'accountId', 'bookedFrom', 'bookedTo', 'direction', 'minAmountMinor', 'maxAmountMinor', 'canonicalType'],
  });
});

test('value sets match the gateway', () => {
  assert.deepEqual(Object.values(BankConnectionStatus), ['PENDING_DOCUMENTS', 'UNDER_REVIEW', 'PENDING_SETUP', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'DISCONNECTED']);
  assert.deepEqual(Object.values(BankAccountStatus), ['ACTIVE', 'INACTIVE']);
  assert.deepEqual(Object.values(BankTransactionDirection), ['CREDIT', 'DEBIT']);
  assert.deepEqual(Object.values(BankTransactionType), [
    'TRANSFER_IN', 'TRANSFER_OUT', 'INTERNAL_IN', 'INTERNAL_OUT', 'POS_SETTLEMENT', 'POS_SETTLEMENT_REFUND', 'FEE', 'TAX',
    'CASH_IN', 'CASH_OUT', 'CARD', 'LOAN', 'FX', 'INTEREST', 'OTHER',
  ]);
  assert.deepEqual(Object.values(BankCapability), ['ACCOUNT_LIST', 'BALANCE', 'TRANSACTIONS', 'OUTGOING_TRANSFER', 'FX_EXCHANGE']);
  assert.deepEqual(Object.values(BankAvailability), ['AVAILABLE', 'COMING_SOON']);
  assert.deepEqual(Object.values(BankSyncStatus), ['QUEUED', 'SCHEDULED']);
  assert.deepEqual(Object.values(BankConnectEvents), ['bank_account.transaction.received']);
});

test('ids are escaped into the path and a 404 keeps its code', async () => {
  const { bank, calls } = makeClient(() => jsonResponse(404, { code: 'bank_connect.account.not_found', message: 'Bank account not found.' }));
  await assert.rejects(() => bank.getAccount('a/b?c'), (error) => error instanceof ApiError
    && error.statusCode === 404 && error.code === 'bank_connect.account.not_found');
  assert.equal(target(calls[0]), '/api/v1/bank-connect/accounts/a%2Fb%3Fc');
});

test('pages read the top-level pageInfo and iterate follows the cursor', async () => {
  const second = transactionJson({ transactionId: '5a4c7e9d-6b8f-4dae-8fca-7b9c1d3e5f6a' });
  const answers = [page([transactionJson()], true, 'cursor-2'), page([second])];
  const { bank, calls } = makeClient(() => jsonResponse(200, answers.shift()));
  const ids = [];
  for await (const row of bank.iterateTransactions({ limit: 1, direction: 'CREDIT' })) ids.push(row.transactionId);
  assert.deepEqual(ids, [TRANSACTION_ID, second.transactionId]);
  assert.equal(queryOf(calls[0]).cursor, undefined);
  assert.deepEqual(queryOf(calls[1]), { limit: '1', cursor: 'cursor-2', direction: 'CREDIT' });
});

test('a page without a cursor is the last one; rows are the gateway JSON as is', async () => {
  const { bank } = makeClient(() => jsonResponse(200, page([{
    bankId: BANK_ID, eftCode: '0000', name: 'ÖRNEK BANKA', country: 'TR', availability: 'AVAILABLE',
    capabilities: ['ACCOUNT_LIST', 'BALANCE', 'TRANSACTIONS'],
  }], true, null)));
  const result = await bank.listBanks();
  assert.equal(result.hasMore, false, 'hasMore without a cursor cannot be followed');
  assert.equal(result.nextCursor, null);
  assert.equal(result.items[0].availability, BankAvailability.AVAILABLE);
  assert.deepEqual(Object.keys(result), ['items', 'hasMore', 'nextCursor']);
});

test('detail reads unwrap data; amounts stay integers', async () => {
  const detail = { ...transactionJson(), balanceAfterMinor: 1250050, documentNo: 'D-0001', bank: bankRef() };
  const { bank } = makeClient(() => jsonResponse(200, envelope(detail)));
  const transaction = await bank.getTransaction(TRANSACTION_ID);
  assert.deepEqual(transaction, detail);
  assert.ok(Number.isInteger(transaction.amountMinor));
});

test('requestSync answers 202 with the sync request', async () => {
  const sync = {
    accountId: ACCOUNT_ID, syncStatus: 'SCHEDULED', scheduledAt: '2026-01-01T07:10:00.000Z',
    lastSuccessfulSyncAt: '2026-01-01T07:05:00.000Z', minSyncIntervalSeconds: 300,
  };
  const { bank } = makeClient(() => jsonResponse(202, envelope(sync)));
  assert.deepEqual(await bank.requestSync(ACCOUNT_ID), sync);
});

test('requestSync rate limit is a RateLimitError with retryAfter; not retried', async () => {
  const { bank, calls } = makeClient(() => jsonResponse(429, {
    code: 'RATE_LIMITED',
    message: 'Too many sync requests for this API key. Retry after the indicated time.',
    details: { retryAfterSeconds: 42 },
  }, { 'retry-after': '42' }));
  await assert.rejects(() => bank.requestSync(ACCOUNT_ID), (error) => error instanceof RateLimitError
    && error.code === 'RATE_LIMITED' && error.retryAfter === 42);
  assert.equal(calls.length, 1);
});

test('requestSync on an inactive connection is 409 not_active', async () => {
  const { bank } = makeClient(() => jsonResponse(409, { code: 'bank_connect.connection.not_active', message: 'Bank connection is not active.', details: { status: 'SUSPENDED' } }));
  await assert.rejects(() => bank.requestSync(ACCOUNT_ID), (error) => error instanceof ApiError && error.code === 'bank_connect.connection.not_active');
});

test('bank_account.transaction.received verifies with WebhookVerifier', () => {
  const secret = 'whsec_test_bank_connect';
  const eventId = '6b5d8f0e-7c9a-5ebf-9adb-8c0d2e4f6a7b';
  const timestamp = new Date().toISOString();
  const data = {
    transactionId: TRANSACTION_ID, accountId: ACCOUNT_ID, connectionId: CONNECTION_ID, bankEftCode: '0000', bankName: 'ÖRNEK BANKA',
    direction: 'DEBIT', amountMinor: 2500, currency: 'TRY', bookedAt: '2026-01-01T07:00:00.000Z', valueAt: null,
    receivedAt: '2026-01-01T07:05:00.000Z', canonicalType: 'FEE', description: null, counterpartyNameMasked: null,
    counterpartyIbanMasked: null, receiptNo: null,
  };
  // The delivery envelope webhook-service builds (buildDeliveryPayload).
  const body = JSON.stringify({
    id: eventId, type: 'bank_account.transaction.received', sourceService: 'bank-connect-service', organizationId: 'org_1',
    productCode: 'BANK_CONNECT', environment: 'TEST', eventVersion: 1, schemaVersion: 'v1', createdAt: timestamp, data,
  });
  const signature = crypto.createHmac('sha256', secret).update(`${eventId}.${timestamp}.${body}`).digest('hex');
  const event = new WebhookVerifier(secret).verify(body, {
    'x-lunixi-event-id': eventId,
    'x-lunixi-event-type': 'bank_account.transaction.received',
    'x-lunixi-signature': `v2=${signature}`,
    'x-lunixi-signature-timestamp': timestamp,
  });
  assert.equal(event.type, BankConnectEvents.TRANSACTION_RECEIVED);
  assert.ok(event.type.startsWith(BANK_CONNECT_EVENT_PATTERN.slice(0, -1)));
  assert.deepEqual(event.data, data);
  assert.equal(event.raw.environment, 'TEST');
});
