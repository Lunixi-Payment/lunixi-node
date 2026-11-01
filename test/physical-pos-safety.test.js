'use strict';

/*
 * Money-safety behaviour of physical POS payment writes: required key, unknown
 * outcomes (unreadable 2xx, dropped connections, ambiguous retry chains),
 * card numbers in values, and the request value rules. Values are synthetic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  PhysicalPosClient,
  PhysicalPosCardDataRejectedError,
  PhysicalPosOutcomeUnknownError,
  PhysicalPosRateLimitError,
  ServiceUnavailableError,
  ValidationError,
  ConfigurationError,
  ApiError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const PAYMENT_ID = '0192f3a1-0000-7000-8000-000000000001';
const KEY = 'pos-safety-key-0001';
const PAN = '4111 1111 1111 1111';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => JSON.stringify(body) };
}

function textResponse(status, text) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => text };
}

const accepted = (replayed = false) => jsonResponse(replayed ? 200 : 202, {
  status: 'success', statusCode: replayed ? 200 : 202, data: { payment: { paymentId: PAYMENT_ID, paymentStatus: 'NOT_STARTED' }, replayed },
});
const failure = (status, code, details, headers) => jsonResponse(status, { status: 'failure', code, message: 'x', statusCode: status, ...(details ? { details } : {}) }, headers);

function makeClient(responders, maxRetries = 0) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), ...init };
    if (call.url === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at', expires_in: 1800 });
    calls.push(call);
    const responder = Array.isArray(responders) ? responders[Math.min(calls.length, responders.length) - 1] : responders;
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_live_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries });
  return { client, pos: client.physicalPos, mgmt: client.physicalPosManagement, calls };
}

const sale = (overrides = {}) => ({ operation: 'SALE', target: { deviceId: 'd1' }, amountMinor: "4500", currency: 'TRY', ...overrides });
const reversal = { operation: 'REFUND', amountMinor: "1500", currency: 'TRY' };
const query = (call) => Object.fromEntries(new URL(call.url).searchParams.entries());

function isUnknown(key, extra = () => {}) {
  return (error) => {
    assert.ok(error instanceof PhysicalPosOutcomeUnknownError, `${error.constructor.name}: ${error.message}`);
    assert.equal(error.idempotencyKey, key);
    extra(error);
    return true;
  };
}

// ── Y-1 ──────────────────────────────────────────────────────────────────────

test('createPayment and createReversal require the key; nothing is sent without it', async () => {
  const { pos, calls } = makeClient(() => accepted());
  await assert.rejects(pos.createPayment(sale()), /Idempotency-Key is required/);
  await assert.rejects(pos.createPayment(sale(), null), ConfigurationError);
  await assert.rejects(pos.createReversal(PAYMENT_ID, reversal), ConfigurationError);
  await assert.rejects(pos.createReversal(PAYMENT_ID, reversal, undefined), ConfigurationError);
  assert.equal(calls.length, 0);
});

test('newIdempotencyKey is a fresh UUID v4; cancelPayment still creates one when omitted', async () => {
  const first = PhysicalPosClient.newIdempotencyKey();
  assert.match(first, UUID_V4);
  assert.notEqual(PhysicalPosClient.newIdempotencyKey(), first);
  const { pos, calls } = makeClient(() => jsonResponse(200, { status: 'success', statusCode: 200, data: { payment: { paymentId: PAYMENT_ID }, replayed: true } }));
  const result = await pos.cancelPayment(PAYMENT_ID);
  assert.match(calls[0].headers['Idempotency-Key'], UUID_V4);
  assert.equal(result.idempotencyKey, calls[0].headers['Idempotency-Key']);
});

// ── O-2 ──────────────────────────────────────────────────────────────────────

test('empty, blank and padded keys are refused everywhere and never trimmed', async () => {
  const { pos, mgmt, calls } = makeClient(() => accepted());
  for (const key of ['', '        ', ' pos-safety-key-0001', 'pos-safety-key-0001 ']) {
    await assert.rejects(pos.createPayment(sale(), key), ConfigurationError);
    await assert.rejects(pos.createReversal(PAYMENT_ID, reversal, key), ConfigurationError);
    await assert.rejects(pos.cancelPayment(PAYMENT_ID, key), ConfigurationError);
    await assert.rejects(mgmt.createStore({ code: 'A', name: 'B' }, key), ConfigurationError);
  }
  assert.equal(calls.length, 0);
});

// ── Y-2 ──────────────────────────────────────────────────────────────────────

test('a 2xx that is not JSON is an unknown outcome, never "accepted"', async () => {
  const { pos } = makeClient(() => textResponse(202, '<html>proxy</html>'));
  await assert.rejects(pos.createPayment(sale(), KEY), isUnknown(KEY));
});

test('a 2xx without a payment is an unknown outcome', async () => {
  for (const body of [{}, { status: 'success', statusCode: 202, data: { replayed: false } }, { data: { payment: { paymentId: '' } } }]) {
    const { pos } = makeClient(() => jsonResponse(202, body));
    await assert.rejects(pos.createReversal(PAYMENT_ID, reversal, KEY), isUnknown(KEY));
  }
});

test('a body that cannot be read after the 2xx headers is an unknown outcome carrying the key', async () => {
  const dropped = () => ({ ok: true, status: 202, headers: new Map(), text: async () => { throw new TypeError('terminated'); } });
  const { pos } = makeClient(dropped);
  await assert.rejects(pos.createPayment(sale(), KEY), isUnknown(KEY, (error) => {
    assert.ok(error.cause instanceof TypeError);
    assert.equal(error.statusCode, 0);
  }));
  const timedOut = () => ({ ok: true, status: 202, headers: new Map(), text: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  await assert.rejects(makeClient(timedOut).pos.cancelPayment(PAYMENT_ID, KEY), isUnknown(KEY));
});

test('an unreadable 2xx is retried with the same key and a later valid answer wins', async () => {
  const { pos, calls } = makeClient([() => textResponse(202, ''), () => accepted(true)], 1);
  const result = await pos.createPayment(sale(), KEY);
  assert.equal(result.replayed, true);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.map((call) => call.headers['Idempotency-Key']), [KEY, KEY]);
});

// ── O-1 + D-1 ────────────────────────────────────────────────────────────────

test('an ambiguous attempt followed by a 429 is still an unknown outcome', async () => {
  const { pos, calls } = makeClient([
    () => failure(502, 'BAD_GATEWAY'),
    () => failure(429, 'RATE_LIMITED', { retryAfterSeconds: 30 }, { 'retry-after': '12' }),
  ], 1);
  await assert.rejects(pos.createPayment(sale(), KEY), isUnknown(KEY, (error) => {
    assert.ok(!(error instanceof PhysicalPosRateLimitError));
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryAfter, 12);
    assert.equal(error.attempts, 2);
    assert.ok(error.cause instanceof ApiError);
  }));
  assert.equal(calls.length, 2);
});

test('a dropped connection followed by a 409 is still an unknown outcome', async () => {
  let n = 0;
  const { pos } = makeClient(() => {
    n += 1;
    if (n === 1) throw new Error('socket hang up');
    return failure(409, 'physical_pos.idempotency_mismatch');
  }, 1);
  await assert.rejects(pos.createReversal(PAYMENT_ID, reversal, KEY), isUnknown(KEY, (error) => assert.equal(error.statusCode, 409)));
});

test('a generic 503 or 504 stays ambiguous; a typed "not started" 503 does not', async () => {
  await assert.rejects(makeClient(() => failure(503, 'SERVICE_UNAVAILABLE')).pos.createPayment(sale(), KEY), isUnknown(KEY));
  await assert.rejects(makeClient(() => failure(504, 'GATEWAY_TIMEOUT')).pos.createPayment(sale(), KEY), isUnknown(KEY));
  await assert.rejects(makeClient(() => failure(500, 'physical_pos.internal.integrity')).pos.createPayment(sale(), KEY), isUnknown(KEY));
  for (const code of ['physical_pos.presence.unavailable', 'physical_pos.signing.unavailable', 'physical_pos.service.busy']) {
    await assert.rejects(makeClient(() => failure(503, code, { retryable: true })).pos.createPayment(sale(), KEY), (error) => {
      assert.ok(error instanceof ServiceUnavailableError);
      assert.ok(!(error instanceof PhysicalPosOutcomeUnknownError));
      assert.equal(error.code, code);
      assert.equal(error.idempotencyKey, KEY);
      return true;
    });
  }
});

test('a "not started" 503 then a 4xx is the plain 4xx; then a success is a success', async () => {
  const busy = () => failure(503, 'physical_pos.service.busy', { retryable: true });
  await assert.rejects(makeClient([busy, () => failure(400, 'physical_pos.payment.amount_invalid', { field: 'amountMinor' })], 1)
    .pos.createPayment(sale(), KEY), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.ok(!(error instanceof PhysicalPosOutcomeUnknownError));
    assert.equal(error.idempotencyKey, KEY);
    return true;
  });
  const { pos, calls } = makeClient([busy, () => accepted()], 1);
  assert.equal((await pos.createPayment(sale(), KEY)).statusCode, 202);
  assert.equal(calls.length, 2);
});

test('a 4xx stops at once and is not retried', async () => {
  const { pos, calls } = makeClient(() => failure(429, 'RATE_LIMITED', { retryAfterSeconds: 9 }), 2);
  await assert.rejects(pos.createPayment(sale(), KEY), (error) => error instanceof PhysicalPosRateLimitError && error.retryAfter === 9 && error.idempotencyKey === KEY);
  assert.equal(calls.length, 1);
});

test('local errors raised before sending are never an unknown outcome', async () => {
  const { pos, calls } = makeClient(() => accepted());
  await assert.rejects(pos.createPayment(sale({ amountMinor: 4500 }), KEY), (error) => error instanceof ConfigurationError && !(error instanceof PhysicalPosOutcomeUnknownError));
  assert.equal(calls.length, 0);
});

// ── O-4 ──────────────────────────────────────────────────────────────────────

test('card numbers in merchantReference, item text and free-text filters are refused before sending', async () => {
  const { pos, mgmt, calls } = makeClient(() => accepted());
  const cases = [
    [() => pos.createPayment(sale({ merchantReference: PAN }), KEY), 'merchantReference'],
    [() => pos.createReversal(PAYMENT_ID, { ...reversal, merchantReference: '4111111111111111' }, KEY), 'merchantReference'],
    [() => pos.createPayment(sale({ amountMinor: "3000", items: [
      { lineNo: 1, name: 'Tea 8691234567012', quantityMilli: 1000, unitCode: 'C62', unitPriceMinor: "1500", taxGroupCode: 'KDV10', lineTotalMinor: "1500" },
      { lineNo: 2, name: `card ${PAN}`, quantityMilli: 1000, unitCode: 'C62', unitPriceMinor: "1500", taxGroupCode: 'KDV10', lineTotalMinor: "1500" },
    ] }), KEY), 'items[1].name'],
    [() => pos.listPayments({ merchantReference: PAN }), 'merchantReference'],
    [() => pos.listTransactions({ merchantReference: '4111-1111-1111-1111' }), 'merchantReference'],
    [() => mgmt.listStores({ q: '4111111111111111' }), 'q'],
    [() => mgmt.listDevices({ q: PAN }), 'q'],
  ];
  for (const [call, field] of cases) {
    await assert.rejects(call(), (error) => {
      assert.ok(error instanceof PhysicalPosCardDataRejectedError, field);
      assert.equal(error.field, field);
      assert.equal(error.statusCode, 0);
      assert.ok(!error.message.includes('4111'));
      return true;
    });
  }
  assert.equal(calls.length, 0);
});

test('references, ids and barcodes that are not card numbers pass', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(200, { status: 'success', data: { items: [] }, pageInfo: { hasMore: false, nextCursor: null } }));
  await pos.listPayments({ merchantReference: 'ORD-4111111111111111' });
  await pos.listPayments({ merchantReference: 'ORD-2026-000123', deviceId: '01a1dea6-4178-7014-8004-a80353225588' });
  assert.equal(query(calls[0]).merchantReference, 'ORD-4111111111111111');
  assert.equal(calls.length, 2);
});

// ── D-2, D-3, D-4 ────────────────────────────────────────────────────────────

test('path ids "." and ".." are refused', async () => {
  const { pos, mgmt, calls } = makeClient(() => accepted());
  await assert.rejects(pos.getPayment('.'), ConfigurationError);
  await assert.rejects(pos.cancelPayment('..', KEY), ConfigurationError);
  await assert.rejects(mgmt.getStore('..'), ConfigurationError);
  assert.equal(calls.length, 0);
});

test('a Date report filter is sent as its own calendar day; created filters as ISO-8601 UTC', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(200, { status: 'success', data: { rows: [] }, pageInfo: { hasMore: false, nextCursor: null } }));
  await pos.getSalesSummary({ dateFrom: new Date(2026, 9, 25, 23, 30), dateTo: new Date(2026, 9, 31, 0, 5) });
  assert.deepEqual(query(calls[0]), { dateFrom: '2026-10-25', dateTo: '2026-10-31' });
  await pos.listPayments({ createdFrom: new Date(Date.UTC(2026, 9, 1)) });
  assert.equal(query(calls[1]).createdFrom, '2026-10-01T00:00:00.000Z');
  await assert.rejects(pos.getTaxSummary({ dateFrom: new Date('nope') }), ConfigurationError);
});

test('empty values are not sent: null only clears nullable fields, empty strings are dropped or refused', async () => {
  const { pos, calls } = makeClient(() => accepted());
  await pos.createPayment(sale({
    allowDuplicateReference: null, instrument: '', merchantReference: null, installmentCount: null,
    target: { deviceId: 'd1', vendorCode: '', externalRef: null },
    items: undefined,
  }), KEY);
  assert.deepEqual(JSON.parse(calls[0].body), {
    operation: 'SALE', target: { deviceId: 'd1' }, amountMinor: "4500", currency: 'TRY', installmentCount: null, merchantReference: null,
  });
  await assert.rejects(pos.createPayment(sale({ operation: '' }), KEY), ConfigurationError);
  const list = makeClient(() => jsonResponse(200, { status: 'success', data: { items: [] }, pageInfo: { hasMore: false } }));
  await list.pos.listPayments({ deviceId: '', paymentStatus: null, merchantReference: undefined });
  assert.equal(new URL(list.calls[0].url).search, '');
});
