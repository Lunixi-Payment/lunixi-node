'use strict';

/*
 * Contract source: nest-payment-gateway apps/api-gateway/src/physical-pos/
 * (payments/physical-pos-payments-api.controller.ts, payments/dtos/physical-pos-payments.dto.ts,
 * payments/physical-pos-payments.service.ts, payments/physical-pos-payments.mapper.ts,
 * payments/physical-pos-card-data.guard.ts, transactions/*, settlements/*), libs/proto/src/physical-pos-card-data.ts,
 * libs/proto/src/physical-pos-webhook.interface.ts. Ids and values below are synthetic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LunixiClient,
  PhysicalPosClient,
  WebhookVerifier,
  parsePhysicalPosWebhookEvent,
  PhysicalPosEvents,
  PhysicalPosPaymentOperation,
  PhysicalPosPaymentStatus,
  PHYSICAL_POS_EVENT_TYPES,
  PHYSICAL_POS_EVENT_PATTERN,
  PhysicalPosCardDataRejectedError,
  PhysicalPosRateLimitError,
  PhysicalPosOutcomeUnknownError,
  PhysicalPosVoidAfterSettlementError,
  RateLimitError,
  ValidationError,
  ConfigurationError,
  ApiError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const PAYMENT_ID = '0192f3a1-0000-7000-8000-000000000001';
const CHILD_ID = '0192f3a1-0000-7000-8000-000000000002';
const DEVICE_ID = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const RUN_ID = '0192f3a1-0000-7000-8000-0000000000e1';
const TERMINAL_PROVIDER_ID = '0192f3a1-0000-7000-8000-0000000000f1';
const KEY = 'pos-test-key-0001';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    text: async () => JSON.stringify(body),
  };
}

function envelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', data, statusCode: 200, requestId: 'req_1', ...extra };
}

function failure(status, code, details = undefined) {
  return { status: 'failure', code, message: 'Rejected.', statusCode: status, requestId: 'req_2', ...(details ? { details } : {}) };
}

function makeClient(responder, options = {}) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), ...init };
    if (call.url === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at_test_1', expires_in: 1800 });
    calls.push(call);
    return responder(call, calls.length);
  };
  const client = new LunixiClient({
    baseUrl: BASE_URL, keyId: 'mk_live_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: options.maxRetries ?? 0,
  });
  return { client, pos: client.physicalPos, calls };
}

const target = (call) => call.url.slice(BASE_URL.length).split('?')[0];
const queryOf = (call) => Object.fromEntries(new URL(call.url).searchParams.entries());
const bodyOf = (call) => (call.body === null || call.body === undefined ? null : JSON.parse(call.body));

function payment(overrides = {}) {
  return {
    paymentId: PAYMENT_ID, rootPaymentId: PAYMENT_ID, originalPaymentId: null, origin: 'API', operation: 'SALE',
    paymentStatus: 'NOT_STARTED', statusReason: null, outcomeConflict: false, resolvable: false, deviceId: DEVICE_ID,
    logicalTerminalId: null, terminalAcquirerId: null, channel: 'APP2APP', vendorReference: PAYMENT_ID.replace(/-/g, ''),
    amountMinor: "4500", approvedAmountMinor: null, currency: 'TRY', installmentCount: null, instrument: 'CARD',
    merchantReference: 'ORD-2026-000123', reversedMinor: "0", capturedMinor: "0", reversalReservedMinor: "0",
    pendingReversalId: null, reversalStatus: 'NONE', expiresAt: '2026-11-01T09:00:30.000Z',
    resultDeadlineAt: '2026-11-01T09:03:30.000Z', completedAt: null, createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z', rowVersion: 1, historySeq: 1, tender: null, items: [], refundItems: [],
    ...overrides,
  };
}

const sale = () => ({
  operation: PhysicalPosPaymentOperation.SALE,
  target: { vendorCode: 'PAVO', serialNumber: 'PAV00012345' },
  amountMinor: "4500",
  currency: 'TRY',
  merchantReference: 'ORD-2026-000123',
  items: [
    { lineNo: 1, name: 'Tea', quantityMilli: 2000, unitCode: 'C62', unitPriceMinor: "1500", taxGroupCode: 'KDV10', lineTotalMinor: "3000", barcode: '8691234567012' },
    { lineNo: 2, name: 'Bagel', quantityMilli: 1000, unitCode: 'C62', unitPriceMinor: "1500", taxGroupCode: 'KDV1', lineTotalMinor: "1500" },
  ],
});

// ── Wiring ────────────────────────────────────────────────────────────────────

test('LunixiClient exposes physicalPos and physicalPosManagement; there is no panel-only resolve method', () => {
  const { client } = makeClient(() => jsonResponse(200, envelope({})));
  assert.ok(client.physicalPos instanceof PhysicalPosClient);
  assert.equal(typeof client.physicalPosManagement.createStore, 'function');
  assert.equal(client.physicalPos.resolvePayment, undefined);
  assert.equal(client.physicalPosManagement.issueActivationCode, undefined);
});

// ── createPayment ─────────────────────────────────────────────────────────────

test('createPayment signs the request, sends the caller key and reads 202 from the envelope', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(202, envelope({ payment: payment(), replayed: false }, { statusCode: 202 })));
  const key = PhysicalPosClient.newIdempotencyKey();
  const result = await pos.createPayment(sale(), key);

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.method, 'POST');
  assert.equal(target(call), '/api/v1/physical-pos/payments');
  assert.ok(call.headers['X-Signature'] && call.headers['X-Key-Id'] && call.headers.Digest);
  assert.match(key, UUID_V4);
  assert.equal(call.headers['Idempotency-Key'], key);
  assert.deepEqual(bodyOf(call), sale());

  assert.equal(result.statusCode, 202);
  assert.equal(result.replayed, false);
  assert.equal(result.payment.paymentStatus, PhysicalPosPaymentStatus.NOT_STARTED);
  assert.equal(result.idempotencyKey, call.headers['Idempotency-Key']);
});

test('createPayment sends the caller key and reports a replay as 200', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(200, envelope({ payment: payment({ paymentStatus: 'APPROVED' }), replayed: true }, { statusCode: 200 })));
  const result = await pos.createPayment(sale(), KEY);
  assert.equal(calls[0].headers['Idempotency-Key'], KEY);
  assert.equal(result.statusCode, 200);
  assert.equal(result.replayed, true);
  assert.equal(result.idempotencyKey, KEY);
});

test('without an envelope statusCode the result falls back to 202 new / 200 replayed', async () => {
  let replayed = false;
  const { pos } = makeClient(() => jsonResponse(202, { status: 'success', data: { payment: payment(), replayed } }));
  assert.equal((await pos.createPayment(sale(), KEY)).statusCode, 202);
  replayed = true;
  assert.equal((await pos.createPayment(sale(), KEY)).statusCode, 200);
});

test('every SDK attempt of a payment write reuses the caller key and body', async () => {
  const { pos, calls } = makeClient((call, n) => (n === 1
    ? jsonResponse(503, failure(503, 'physical_pos.service.busy', { retryable: true }))
    : jsonResponse(202, envelope({ payment: payment(), replayed: false }, { statusCode: 202 }))), { maxRetries: 1 });
  const result = await pos.createPayment(sale(), KEY);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['Idempotency-Key'], KEY);
  assert.equal(calls[1].headers['Idempotency-Key'], KEY);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(result.statusCode, 202);
});

test('optional fields are sent as given; null clears nullable fields and drops the others', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(202, envelope({ payment: payment(), replayed: false }, { statusCode: 202 })));
  await pos.createPayment({
    operation: 'SALE', target: { deviceId: DEVICE_ID, vendorCode: null }, amountMinor: "1000", currency: 'TRY',
    installmentCount: 3, instrument: null, allowDuplicateReference: true, startTimeoutSeconds: 20,
    terminalAcquirerId: null, merchantReference: undefined,
  }, KEY);
  assert.deepEqual(bodyOf(calls[0]), {
    operation: 'SALE', target: { deviceId: DEVICE_ID }, amountMinor: "1000", currency: 'TRY', installmentCount: 3,
    instrument: null, allowDuplicateReference: true, startTimeoutSeconds: 20, terminalAcquirerId: null,
  });
});

test('a meal card payment sends instrument, interaction and terminalProviderId', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(202, envelope({ payment: payment({ instrument: 'MEAL_CARD' }), replayed: false }, { statusCode: 202 })));
  const request = {
    operation: 'SALE', target: { deviceId: DEVICE_ID }, amountMinor: '4500', currency: 'TRY', instrument: 'MEAL_CARD',
    interaction: 'CODE_DISPLAY', terminalProviderId: TERMINAL_PROVIDER_ID,
  };
  const result = await pos.createPayment(request, KEY);
  assert.deepEqual(bodyOf(calls[0]), request);
  assert.equal(result.payment.instrument, 'MEAL_CARD');
  await pos.createPayment({ ...request, interaction: null, terminalProviderId: null }, KEY);
  assert.deepEqual(bodyOf(calls[1]), { ...request, interaction: null, terminalProviderId: null });
  await assert.rejects(pos.createPayment({ ...request, interaction: 7 }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...request, providerCode: 'METROPOL' }, KEY), ConfigurationError);
  assert.equal(calls.length, 2);
});

// ── Card data and request checks (nothing is sent) ───────────────────────────

test('card data fields are refused before sending, with the field path only', async () => {
  const { pos, calls } = makeClient(() => assert.fail('must not send'));
  const cases = [
    [{ ...sale(), cardNumber: '4543600000001234' }, 'cardNumber'],
    [{ ...sale(), pan: 'x' }, 'pan'],
    [{ ...sale(), target: { deviceId: DEVICE_ID, pan: 'x' } }, 'target.pan'],
    [{ ...sale(), items: [sale().items[0], { ...sale().items[1], cvv: '123' }] }, 'items[1].cvv'],
    [{ ...sale(), expiryDate: '12/30' }, 'expiryDate'],
    [{ ...sale(), track2Data: 'x' }, 'track2Data'],
    [{ ...sale(), card_sec_code: 'x' }, null],
  ];
  for (const [request, field] of cases) {
    if (field === null) {
      await assert.rejects(pos.createPayment(request, KEY), ConfigurationError);
      continue;
    }
    await assert.rejects(pos.createPayment(request, KEY), (error) => {
      assert.ok(error instanceof PhysicalPosCardDataRejectedError);
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, 'physical_pos.payment.card_data_rejected');
      assert.equal(error.field, field);
      assert.equal(error.statusCode, 0);
      assert.ok(!error.message.includes('4543600000001234'));
      return true;
    });
  }
  await assert.rejects(pos.createReversal(PAYMENT_ID, { operation: 'VOID', currency: 'TRY', cvc2: '1' }, KEY), PhysicalPosCardDataRejectedError);
  await assert.rejects(pos.listPayments({ pan: '4543600000001234' }), (error) => error instanceof PhysicalPosCardDataRejectedError && error.field === 'pan');
  assert.equal(calls.length, 0);
});

test('masked card names and harmless look-alikes are plain unknown fields, not card data', async () => {
  const { pos } = makeClient(() => assert.fail('must not send'));
  for (const key of ['maskedPan', 'panel', 'company', 'expiresAt', 'trackingNo']) {
    await assert.rejects(pos.createPayment({ ...sale(), [key]: 'x' }, KEY), (error) => error instanceof ConfigurationError);
  }
});

test('unknown fields, environment, tenant fields, wrong types and bad keys are refused before sending', async () => {
  const { pos, calls } = makeClient(() => assert.fail('must not send'));
  await assert.rejects(pos.createPayment({ ...sale(), environment: 'LIVE' }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), organizationId: 'org' }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), amountMinor: 4500 }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), amountMinor: 45.5 }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), target: undefined }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), items: [] }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), items: [{ lineNo: 1 }] }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment({ ...sale(), currency: '' }, KEY), ConfigurationError);
  await assert.rejects(pos.createPayment(sale(), 'short'), ConfigurationError);
  await assert.rejects(pos.createPayment(sale(), 'has a space in it'), ConfigurationError);
  await assert.rejects(pos.createReversal('', { operation: 'VOID', currency: 'TRY' }, KEY), ConfigurationError);
  await assert.rejects(pos.createReversal('..', { operation: 'VOID', currency: 'TRY' }, KEY), ConfigurationError);
  assert.equal(calls.length, 0);
});

// ── Error mapping ────────────────────────────────────────────────────────────

test('a gateway card_data_rejected answer becomes PhysicalPosCardDataRejectedError with details.field', async () => {
  const { pos } = makeClient(() => jsonResponse(400, failure(400, 'physical_pos.payment.card_data_rejected', { field: 'items[0].name' })));
  await assert.rejects(pos.createPayment(sale(), KEY), (error) => {
    assert.ok(error instanceof PhysicalPosCardDataRejectedError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.field, 'items[0].name');
    assert.equal(error.idempotencyKey, KEY);
    return true;
  });
});

test('429 becomes PhysicalPosRateLimitError with Retry-After, or details.retryAfterSeconds without the header', async () => {
  let headers = { 'retry-after': '17' };
  const { pos } = makeClient(() => jsonResponse(429, failure(429, 'RATE_LIMITED', { retryAfterSeconds: 30 }), headers));
  await assert.rejects(pos.createPayment(sale(), KEY), (error) => {
    assert.ok(error instanceof PhysicalPosRateLimitError);
    assert.equal(error.idempotencyKey, KEY);
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.retryAfter, 17);
    return true;
  });
  headers = {};
  await assert.rejects(pos.listPayments(), (error) => error instanceof PhysicalPosRateLimitError && error.retryAfter === 30);
});

test('no HTTP answer on a payment write is PhysicalPosOutcomeUnknownError carrying the key', async () => {
  const { pos } = makeClient(() => { throw new Error('socket hang up'); });
  await assert.rejects(pos.createPayment(sale(), KEY), (error) => {
    assert.ok(error instanceof PhysicalPosOutcomeUnknownError);
    assert.equal(error.idempotencyKey, KEY);
    assert.equal(error.statusCode, 0);
    assert.ok(error.cause instanceof ApiError);
    return true;
  });
});

test('a 5xx on a write is an unknown outcome; on a read it stays the plain error', async () => {
  const { pos } = makeClient(() => jsonResponse(504, failure(504, 'GATEWAY_TIMEOUT')));
  await assert.rejects(pos.createReversal(PAYMENT_ID, { operation: 'VOID', currency: 'TRY' }, KEY), (error) => {
    assert.ok(error instanceof PhysicalPosOutcomeUnknownError);
    assert.equal(error.statusCode, 504);
    assert.equal(error.idempotencyKey, KEY);
    return true;
  });
  await assert.rejects(pos.cancelPayment(PAYMENT_ID), PhysicalPosOutcomeUnknownError);
  await assert.rejects(pos.getPayment(PAYMENT_ID), (error) => !(error instanceof PhysicalPosOutcomeUnknownError) && error.statusCode === 504);
});

test('a definite 4xx on a write passes through with the key attached', async () => {
  const { pos } = makeClient(() => jsonResponse(409, failure(409, 'physical_pos.idempotency_mismatch')));
  await assert.rejects(pos.createPayment(sale(), KEY), (error) => {
    assert.ok(error instanceof ApiError);
    assert.ok(!(error instanceof PhysicalPosOutcomeUnknownError));
    assert.equal(error.code, 'physical_pos.idempotency_mismatch');
    assert.equal(error.idempotencyKey, KEY);
    return true;
  });
});

test('a void of a settled payment becomes PhysicalPosVoidAfterSettlementError with allowedOperation', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(409, failure(409, 'physical_pos.payment.void_after_settlement', { allowedOperation: 'REFUND' })));
  await assert.rejects(pos.createReversal(PAYMENT_ID, { operation: 'VOID', currency: 'TRY' }, KEY), (error) => {
    assert.ok(error instanceof PhysicalPosVoidAfterSettlementError);
    assert.ok(error instanceof ApiError);
    assert.ok(!(error instanceof PhysicalPosOutcomeUnknownError));
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, PhysicalPosVoidAfterSettlementError.CODE);
    assert.equal(error.allowedOperation, 'REFUND');
    assert.equal(error.idempotencyKey, KEY);
    return true;
  });
  assert.equal(calls.length, 1, 'a definite 409 is not retried');
  const { pos: bare } = makeClient(() => jsonResponse(409, failure(409, 'physical_pos.payment.void_after_settlement')));
  await assert.rejects(bare.createReversal(PAYMENT_ID, { operation: 'VOID', currency: 'TRY' }, KEY), (error) => {
    assert.ok(error instanceof PhysicalPosVoidAfterSettlementError);
    assert.equal(error.allowedOperation, null);
    return true;
  });
});

// ── Reversal and cancel ──────────────────────────────────────────────────────

test('createReversal posts to the root payment with item based refund lines', async () => {
  const child = payment({ paymentId: CHILD_ID, originalPaymentId: PAYMENT_ID, operation: 'REFUND', amountMinor: "1500" });
  const { pos, calls } = makeClient(() => jsonResponse(202, envelope({ payment: child, replayed: false }, { statusCode: 202 })));
  const result = await pos.createReversal(PAYMENT_ID, {
    operation: 'REFUND', currency: 'TRY', items: [{ lineNo: 1, quantityMilli: 1000 }],
    target: { externalRef: 'TILL-2' },
  }, KEY);
  assert.equal(target(calls[0]), `/api/v1/physical-pos/payments/${PAYMENT_ID}/reversals`);
  assert.deepEqual(bodyOf(calls[0]), {
    operation: 'REFUND', currency: 'TRY', target: { externalRef: 'TILL-2' }, items: [{ lineNo: 1, quantityMilli: 1000 }],
  });
  assert.equal(result.payment.originalPaymentId, PAYMENT_ID);
  assert.equal(result.statusCode, 202);
});

test('cancelPayment posts an empty body with a key and returns the current view', async () => {
  const expired = payment({ paymentStatus: 'EXPIRED', statusReason: 'MERCHANT_CANCELLED_BEFORE_DISPATCH' });
  const { pos, calls } = makeClient(() => jsonResponse(200, envelope({ payment: expired, replayed: false })));
  const result = await pos.cancelPayment(PAYMENT_ID);
  assert.equal(target(calls[0]), `/api/v1/physical-pos/payments/${PAYMENT_ID}/cancel`);
  assert.deepEqual(bodyOf(calls[0]), {});
  assert.match(calls[0].headers['Idempotency-Key'], UUID_V4);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payment.statusReason, 'MERCHANT_CANCELLED_BEFORE_DISPATCH');
});

// ── Reads ────────────────────────────────────────────────────────────────────

test('getPayment unwraps { payment } and encodes the id', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(200, envelope({ payment: payment({ paymentStatus: 'APPROVED' }) })));
  const view = await pos.getPayment(PAYMENT_ID);
  assert.equal(view.paymentStatus, 'APPROVED');
  assert.equal(calls[0].method, 'GET');
  assert.ok(calls[0].headers['X-Signature']);
  assert.equal(calls[0].headers['Idempotency-Key'], undefined);
  await pos.getPayment('a/b');
  assert.equal(target(calls[1]), '/api/v1/physical-pos/payments/a%2Fb');
});

test('listPayments sends known filters and reads paging from the envelope pageInfo', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(200, envelope({ items: [payment()], pageInfo: { hasMore: true, nextCursor: 'c2', totalCount: null } }, {
    pageInfo: { hasMore: true, nextCursor: 'c2', totalCount: null },
  })));
  const page = await pos.listPayments({
    limit: 50, deviceId: DEVICE_ID, paymentStatus: 'UNKNOWN', merchantReference: 'ORD-1',
    createdFrom: new Date('2026-10-01T00:00:00.000Z'), createdTo: '2026-11-01T00:00:00.000Z', cursor: null,
  });
  assert.deepEqual(queryOf(calls[0]), {
    limit: '50', deviceId: DEVICE_ID, paymentStatus: 'UNKNOWN', createdFrom: '2026-10-01T00:00:00.000Z',
    createdTo: '2026-11-01T00:00:00.000Z', merchantReference: 'ORD-1',
  });
  assert.deepEqual({ ...page, items: page.items.length }, { items: 1, hasMore: true, nextCursor: 'c2', totalCount: null });
  await assert.rejects(pos.listPayments({ limit: 0 }), ConfigurationError);
  await assert.rejects(pos.listPayments({ limit: 101 }), ConfigurationError);
  await assert.rejects(pos.listPayments({ environment: 'LIVE' }), ConfigurationError);
  await assert.rejects(pos.listPayments({ operation: 'SALE' }), ConfigurationError);
});

test('iteratePayments follows nextCursor until the last page', async () => {
  const { pos, calls } = makeClient((call) => {
    const cursor = new URL(call.url).searchParams.get('cursor');
    if (!cursor) return jsonResponse(200, envelope({ items: [payment()] }, { pageInfo: { hasMore: true, nextCursor: 'c2' } }));
    return jsonResponse(200, envelope({ items: [payment({ paymentId: CHILD_ID })] }, { pageInfo: { hasMore: false, nextCursor: null } }));
  });
  const ids = [];
  for await (const row of pos.iteratePayments({ limit: 1 })) ids.push(row.paymentId);
  assert.deepEqual(ids, [PAYMENT_ID, CHILD_ID]);
  assert.equal(queryOf(calls[1]).cursor, 'c2');
});

test('transactions, ambiguous payments, reports and settlements use their routes and filters', async () => {
  const { pos, calls } = makeClient((call) => {
    const path = target(call);
    if (path.endsWith('/transactions/ambiguous')) return jsonResponse(200, envelope({ items: [payment({ paymentStatus: 'MANUAL_REVIEW', resolvable: true })] }, { pageInfo: { hasMore: false, nextCursor: null } }));
    if (path.includes('/transactions/')) return jsonResponse(200, envelope({ transaction: { requestedPaymentId: CHILD_ID, root: payment(), children: [], timeline: [], timelineTruncated: false, childrenTruncated: false, storeId: null, registerId: null } }));
    if (path.endsWith('/transactions')) return jsonResponse(200, envelope({ items: [{ root: payment(), children: [], childrenTruncated: false, itemSummary: { lineCount: 2, refundStatus: 'NONE', refundedMinor: "0" }, storeId: null, registerId: null }] }, { pageInfo: { hasMore: false, nextCursor: null } }));
    if (path.endsWith('/sales-summary')) return jsonResponse(200, envelope({ environment: 'LIVE', dateFrom: '2026-10-25', dateTo: '2026-10-31', groupBy: 'STORE', rows: [] }));
    if (path.endsWith('/tax-summary')) return jsonResponse(200, envelope({ environment: 'LIVE', dateFrom: '2026-10-25', dateTo: '2026-10-31', rows: [], amountTotals: [] }));
    return jsonResponse(200, envelope({ items: [] }, { pageInfo: { hasMore: false, nextCursor: null } }));
  });

  const trees = await pos.listTransactions({ storeId: DEVICE_ID, amountFromMinor: "100", amountToMinor: "9000", origin: 'DEVICE_DIRECT', operation: 'SALE' });
  assert.equal(target(calls[0]), '/api/v1/physical-pos/transactions');
  assert.deepEqual(queryOf(calls[0]), { storeId: DEVICE_ID, amountFromMinor: '100', amountToMinor: '9000', origin: 'DEVICE_DIRECT', operation: 'SALE' });
  assert.equal(trees.items[0].itemSummary.lineCount, 2);

  const detail = await pos.getTransaction(CHILD_ID);
  assert.equal(target(calls[1]), `/api/v1/physical-pos/transactions/${CHILD_ID}`);
  assert.equal(detail.requestedPaymentId, CHILD_ID);

  const ambiguous = await pos.listAmbiguousPayments({ paymentStatus: 'MANUAL_REVIEW' });
  assert.equal(target(calls[2]), '/api/v1/physical-pos/transactions/ambiguous');
  assert.equal(ambiguous.items[0].resolvable, true);

  const sales = await pos.getSalesSummary({ dateFrom: '2026-10-25', dateTo: '2026-10-31', groupBy: 'STORE' });
  assert.equal(target(calls[3]), '/api/v1/physical-pos/reports/sales-summary');
  assert.equal(sales.groupBy, 'STORE');
  await pos.getTaxSummary({ deviceId: DEVICE_ID });
  assert.equal(target(calls[4]), '/api/v1/physical-pos/reports/tax-summary');
  await assert.rejects(pos.getTaxSummary({ groupBy: 'DAY' }), ConfigurationError);

  await pos.listSettlements({ lineStatus: 'MISMATCH', createdFrom: '2026-10-01T00:00:00.000Z' });
  assert.equal(target(calls[5]), '/api/v1/physical-pos/settlements');
  assert.deepEqual(queryOf(calls[5]), { lineStatus: 'MISMATCH', createdFrom: '2026-10-01T00:00:00.000Z' });
  await assert.rejects(pos.listTransactions({ amountFromMinor: 100 }), ConfigurationError);
});

// ── End-of-day runs ──────────────────────────────────────────────────────────

const run = (overrides = {}) => ({
  runId: RUN_ID, deviceId: DEVICE_ID, environment: 'LIVE', source: 'MANUAL_API', runStatus: 'PENDING', reason: null,
  businessDate: '2026-11-03', commandId: null, commandStatus: null, deliveryPath: null, resultState: null, attemptCount: 0,
  nextAttemptAt: null, windowEndsAt: null, resultLineCount: 0, completedAt: null, createdAt: '2026-11-03T18:00:00.000Z',
  updatedAt: '2026-11-03T18:00:00.000Z', ...overrides,
});

test('startSettlement posts an empty body with the key and reports 202 new / 200 replayed', async () => {
  let replayed = false;
  const { pos, calls } = makeClient(() => jsonResponse(replayed ? 200 : 202, { status: 'success', data: { run: run(), replayed } }));
  const started = await pos.startSettlement(DEVICE_ID, KEY);
  assert.equal(calls[0].method, 'POST');
  assert.equal(target(calls[0]), `/api/v1/physical-pos/devices/${DEVICE_ID}/settlement`);
  assert.deepEqual(bodyOf(calls[0]), {});
  assert.equal(calls[0].headers['Idempotency-Key'], KEY);
  assert.ok(calls[0].headers['X-Signature']);
  assert.deepEqual(started, { run: run(), replayed: false, statusCode: 202, idempotencyKey: KEY });

  replayed = true;
  const again = await pos.startSettlement(DEVICE_ID);
  assert.match(calls[1].headers['Idempotency-Key'], UUID_V4);
  assert.equal(again.idempotencyKey, calls[1].headers['Idempotency-Key']);
  assert.equal(again.statusCode, 200);
  assert.equal(again.replayed, true);

  await assert.rejects(pos.startSettlement('', KEY), ConfigurationError);
  await assert.rejects(pos.startSettlement(DEVICE_ID, 'short'), ConfigurationError);
  assert.equal(calls.length, 2);
});

test('a TEST key settlement refusal keeps the key on the error', async () => {
  const { pos } = makeClient(() => jsonResponse(403, failure(403, 'physical_pos.environment.test_key_read_only')));
  await assert.rejects(pos.startSettlement(DEVICE_ID, KEY), (error) => error instanceof ApiError
    && error.code === 'physical_pos.environment.test_key_read_only' && error.idempotencyKey === KEY);
});

test('settlement runs: list with filters, iterate and read one', async () => {
  const { pos, calls } = makeClient((call) => {
    const path = target(call);
    if (path.endsWith(`/settlement-runs/${RUN_ID}`)) return jsonResponse(200, envelope({ run: run({ runStatus: 'STARTED' }) }));
    if (new URL(call.url).searchParams.get('cursor')) {
      return jsonResponse(200, envelope({ items: [run({ runId: 'r2' })] }, { pageInfo: { hasMore: false, nextCursor: null } }));
    }
    return jsonResponse(200, envelope({ items: [run()] }, { pageInfo: { hasMore: true, nextCursor: 'r1', totalCount: 2 } }));
  });
  const page = await pos.listSettlementRuns({
    limit: 10, deviceId: DEVICE_ID, source: 'SCHEDULED', runStatus: 'FAILED',
    createdFrom: new Date('2026-11-01T00:00:00.000Z'), createdTo: '2026-11-03T00:00:00.000Z', includeTotal: true,
  });
  assert.equal(target(calls[0]), '/api/v1/physical-pos/settlement-runs');
  assert.deepEqual(queryOf(calls[0]), {
    limit: '10', includeTotal: 'true', deviceId: DEVICE_ID, source: 'SCHEDULED', runStatus: 'FAILED',
    createdFrom: '2026-11-01T00:00:00.000Z', createdTo: '2026-11-03T00:00:00.000Z',
  });
  assert.deepEqual({ ...page, items: page.items.length }, { items: 1, hasMore: true, nextCursor: 'r1', totalCount: 2 });

  const ids = [];
  for await (const row of pos.iterateSettlementRuns()) ids.push(row.runId);
  assert.deepEqual(ids, [RUN_ID, 'r2']);
  assert.deepEqual(queryOf(calls[2]), { cursor: 'r1' });

  const one = await pos.getSettlementRun(RUN_ID);
  assert.equal(target(calls[3]), `/api/v1/physical-pos/settlement-runs/${RUN_ID}`);
  assert.equal(calls[3].headers['Idempotency-Key'], undefined);
  assert.equal(one.runStatus, 'STARTED');

  await assert.rejects(pos.listSettlementRuns({ lineStatus: 'MATCHED' }), ConfigurationError);
  await assert.rejects(pos.listSettlementRuns({ includeTotal: 'yes' }), ConfigurationError);
  await assert.rejects(pos.getSettlementRun('..'), ConfigurationError);
  assert.equal(calls.length, 4);
});

// ── Webhook ──────────────────────────────────────────────────────────────────

const SECRET = 'whsec_test_physical_pos';

function signed(body, eventId = 'evt_1') {
  const raw = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const signature = crypto.createHmac('sha256', SECRET).update(`${eventId}.${timestamp}.${raw}`).digest('hex');
  return {
    raw,
    headers: {
      'x-lunixi-event-id': eventId,
      'x-lunixi-event-type': body.type,
      'x-lunixi-signature-timestamp': timestamp,
      'x-lunixi-signature': `v2=${signature}`,
    },
  };
}

const paymentData = () => ({
  paymentId: PAYMENT_ID, rootPaymentId: PAYMENT_ID, operation: 'SALE', paymentStatus: 'APPROVED',
  statusReason: 'DEVICE_RESULT_APPROVED', amountMinor: '4500', approvedAmountMinor: '4500', currency: 'TRY',
  installmentCount: null, deviceId: DEVICE_ID, merchantReference: 'ORD-2026-000123',
  tender: { cardMasked: '454360******1234', cardBrand: 'VISA', entryMode: 'CONTACTLESS' }, historySeq: 4, resolvedBy: null,
});

test('event catalog: 8 payment status, 1 device sale, 4 fiscal document and 4 end-of-day webhooks', () => {
  assert.equal(PHYSICAL_POS_EVENT_PATTERN, 'physical_pos.*');
  assert.equal(PHYSICAL_POS_EVENT_TYPES.length, 17);
  assert.deepEqual(PHYSICAL_POS_EVENT_TYPES.slice(13), [
    'physical_pos.settlement.completed', 'physical_pos.settlement.failed', 'physical_pos.settlement.overdue',
    'physical_pos.settlement.skipped',
  ]);
  assert.equal(PhysicalPosEvents.SETTLEMENT_SKIPPED, 'physical_pos.settlement.skipped');
  assert.equal(PhysicalPosEvents.PAYMENT_DEVICE_SALE, 'physical_pos.payment.device_sale');
  assert.ok(PHYSICAL_POS_EVENT_TYPES.includes(PhysicalPosEvents.PAYMENT_DEVICE_SALE));
  assert.equal(PhysicalPosEvents.PAYMENT_PARTIALLY_APPROVED, 'physical_pos.payment.partially_approved');
  assert.ok(!PHYSICAL_POS_EVENT_TYPES.includes('physical_pos.payment.created'));
  assert.ok(PHYSICAL_POS_EVENT_TYPES.every((type) => type.startsWith('physical_pos.')));
});

test('a signed physical_pos webhook is verified and read from data', () => {
  const body = {
    id: 'evt_1', type: PhysicalPosEvents.PAYMENT_APPROVED, sourceService: 'physical-pos-service', organizationId: 'org_1',
    productCode: 'PHYSICAL_POS', environment: 'LIVE', eventVersion: 1, schemaVersion: 'v1', createdAt: '2026-11-01T09:00:05.000Z',
    data: paymentData(),
  };
  const { raw, headers } = signed(body);
  const event = PhysicalPosClient.parseWebhookEvent(raw, headers, SECRET);
  assert.equal(event.id, 'evt_1');
  assert.equal(event.type, 'physical_pos.payment.approved');
  assert.equal(event.category, 'payment');
  assert.equal(event.environment, 'LIVE');
  assert.equal(event.historySeq, 4);
  assert.equal(event.data.amountMinor, '4500');
  assert.equal(event.data.tender.cardBrand, 'VISA');
  const viaVerifier = parsePhysicalPosWebhookEvent(Buffer.from(raw), headers, new WebhookVerifier(SECRET));
  assert.equal(viaVerifier.id, 'evt_1');
  assert.equal(event.cashier, null, 'no cashier session: the key is absent and cashier is null');
});

test('a payment event from a cashier session carries cashier { cashierId, cashierCode }', () => {
  const body = {
    id: 'evt_c1', type: PhysicalPosEvents.PAYMENT_APPROVED, environment: 'LIVE', createdAt: '2026-11-01T09:00:05.000Z',
    data: { ...paymentData(), cashier: { cashierId: 'cashier_1', cashierCode: 'K01' } },
  };
  const { raw, headers } = signed(body, 'evt_c1');
  const event = PhysicalPosClient.parseWebhookEvent(raw, headers, SECRET);
  assert.deepEqual(event.cashier, { cashierId: 'cashier_1', cashierCode: 'K01' });
  assert.deepEqual(event.data.cashier, { cashierId: 'cashier_1', cashierCode: 'K01' });
});

test('end-of-day webhooks are read with category settlement and string amounts', () => {
  const totals = { saleCount: 42, saleMinor: '1284050', refundCount: 1, refundMinor: '15000', voidCount: 0, voidMinor: '0' };
  const completed = {
    id: 'evt_s1', type: PhysicalPosEvents.SETTLEMENT_COMPLETED, environment: 'LIVE', createdAt: '2026-11-03T20:15:41.307Z',
    data: {
      settlementId: 'set_1', runId: 'run_1', deviceId: DEVICE_ID, source: 'MANUAL_API', late: false,
      periodFrom: '2026-11-02T20:31:12.004Z', periodTo: '2026-11-03T20:15:40.220Z', deviceClosedAt: null,
      recordedAt: '2026-11-03T20:15:41.307Z', lineCount: 1, mismatchedLineCount: 0, unmappedLineCount: 0,
      lines: [{ lineNo: 1, acquirerCode: 'BANK1', currency: 'TRY', lineStatus: 'MATCHED', reported: totals, system: totals }],
    },
  };
  let signedBody = signed(completed, 'evt_s1');
  const event = PhysicalPosClient.parseWebhookEvent(signedBody.raw, signedBody.headers, SECRET);
  assert.equal(event.category, 'settlement');
  assert.equal(event.historySeq, null);
  assert.equal(event.cashier, null);
  assert.equal(event.data.lines[0].reported.saleMinor, '1284050');

  const failed = {
    id: 'evt_s2', type: PhysicalPosEvents.SETTLEMENT_FAILED,
    payloadJson: JSON.stringify({
      runId: 'run_2', deviceId: DEVICE_ID, source: 'SCHEDULED', businessDate: '2026-11-02', reason: 'DEVICE_OFFLINE',
      attemptCount: 7, windowEndsAt: '2026-11-02T22:30:00.000Z', failedAt: '2026-11-02T22:28:00.112Z',
    }),
  };
  signedBody = signed(failed, 'evt_s2');
  const failure = PhysicalPosClient.parseWebhookEvent(signedBody.raw, signedBody.headers, SECRET);
  assert.equal(failure.category, 'settlement');
  assert.equal(failure.data.reason, 'DEVICE_OFFLINE');

  const numeric = { ...completed, id: 'evt_s3', data: { ...completed.data, lines: [{ ...completed.data.lines[0], system: { ...totals, saleMinor: 1284050 } }] } };
  signedBody = signed(numeric, 'evt_s3');
  assert.throws(() => PhysicalPosClient.parseWebhookEvent(signedBody.raw, signedBody.headers, SECRET), ConfigurationError);
});

test('a device sale and a refund of it are read with isDeviceSale and original', () => {
  const sold = {
    ...paymentData(), original: null, statusReason: null, merchantReference: null, historySeq: 1,
    origin: 'DEVICE_DIRECT', deviceOccurredAt: '2026-11-01T18:42:10.123Z',
  };
  const saleDelivery = signed({ id: 'evt_ds', type: PhysicalPosEvents.PAYMENT_DEVICE_SALE, environment: 'LIVE', data: sold }, 'evt_ds');
  const event = parsePhysicalPosWebhookEvent(saleDelivery.raw, saleDelivery.headers, SECRET);
  assert.equal(event.type, 'physical_pos.payment.device_sale');
  assert.equal(event.category, 'payment');
  assert.equal(event.isDeviceSale, true);
  assert.equal(event.original, null);
  assert.equal(event.historySeq, 1);
  assert.equal(event.data.origin, 'DEVICE_DIRECT');
  assert.equal(event.data.deviceOccurredAt, '2026-11-01T18:42:10.123Z');

  const refund = {
    ...paymentData(), paymentId: CHILD_ID, operation: 'REFUND', historySeq: 3,
    original: { paymentId: PAYMENT_ID, origin: 'DEVICE_DIRECT' },
  };
  const child = signed({ id: 'evt_rf', type: PhysicalPosEvents.PAYMENT_APPROVED, data: refund }, 'evt_rf');
  const refundEvent = parsePhysicalPosWebhookEvent(child.raw, child.headers, SECRET);
  assert.equal(refundEvent.isDeviceSale, false);
  assert.deepEqual(refundEvent.original, { paymentId: PAYMENT_ID, origin: 'DEVICE_DIRECT' });
  assert.equal(refundEvent.data.rootPaymentId, PAYMENT_ID);
});

test('a payloadJson envelope (object or JSON string) is read after verification', () => {
  const base = { eventId: 'evt_2', eventType: PhysicalPosEvents.PAYMENT_UNKNOWN, environment: 'LIVE', occurredAt: '2026-11-01T09:04:00.000Z' };
  const fromObject = signed({ ...base, payloadJson: { ...paymentData(), paymentStatus: 'UNKNOWN', historySeq: 5 } }, 'evt_2');
  const event = parsePhysicalPosWebhookEvent(fromObject.raw, fromObject.headers, SECRET);
  assert.equal(event.id, 'evt_2');
  assert.equal(event.type, 'physical_pos.payment.unknown');
  assert.equal(event.createdAt, '2026-11-01T09:04:00.000Z');
  assert.equal(event.data.paymentStatus, 'UNKNOWN');
  const fromString = signed({ ...base, payloadJson: JSON.stringify(paymentData()) }, 'evt_2');
  assert.equal(parsePhysicalPosWebhookEvent(fromString.raw, fromString.headers, SECRET).data.paymentId, PAYMENT_ID);
  const fiscal = signed({ id: 'evt_3', type: PhysicalPosEvents.FISCAL_DOCUMENT_ACTION_REQUIRED, data: { documentId: 'd1', historySeq: 2 } }, 'evt_3');
  assert.equal(parsePhysicalPosWebhookEvent(fiscal.raw, fiscal.headers, SECRET).category, 'fiscal_document');
});

test('unsigned, forged, tampered or foreign-secret webhooks are never read', () => {
  const body = { id: 'evt_9', type: PhysicalPosEvents.PAYMENT_APPROVED, data: paymentData() };
  const { raw, headers } = signed(body, 'evt_9');
  // A decoded envelope or a look-alike of the verifier result is not an input.
  assert.throws(() => parsePhysicalPosWebhookEvent(body, headers, SECRET), ConfigurationError);
  assert.throws(() => parsePhysicalPosWebhookEvent({ id: 'evt_9', type: body.type, data: body.data, raw: body }, headers, SECRET), ConfigurationError);
  assert.throws(() => parsePhysicalPosWebhookEvent(raw, {}, SECRET), ConfigurationError);
  assert.throws(() => parsePhysicalPosWebhookEvent(raw.replace('4500', '9500'), headers, SECRET), ConfigurationError);
  assert.throws(() => parsePhysicalPosWebhookEvent(raw, { ...headers, 'x-lunixi-event-id': 'evt_other' }, SECRET), ConfigurationError);
  assert.throws(() => parsePhysicalPosWebhookEvent(raw, headers, 'whsec_someone_else'), ConfigurationError);
  assert.throws(() => parsePhysicalPosWebhookEvent(raw, headers, ''), ConfigurationError);
});

test('non physical POS events, empty payloads and broken payloadJson are refused after verification', () => {
  for (const body of [
    { id: 'e', type: 'payment.succeeded', data: { a: 1 } },
    { id: 'e', type: 'physical_pos.payment.approved', data: {} },
    { id: 'e', type: 'physical_pos.payment.approved', payloadJson: '{oops' },
  ]) {
    const { raw, headers } = signed(body, 'e');
    assert.throws(() => parsePhysicalPosWebhookEvent(raw, headers, SECRET), ConfigurationError);
  }
  const notJson = 'not json';
  const timestamp = new Date().toISOString();
  const signature = crypto.createHmac('sha256', SECRET).update(`e.${timestamp}.${notJson}`).digest('hex');
  assert.throws(() => parsePhysicalPosWebhookEvent(notJson, {
    'x-lunixi-event-id': 'e', 'x-lunixi-signature-timestamp': timestamp, 'x-lunixi-signature': `v2=${signature}`,
  }, SECRET), ConfigurationError);
});

test('physical POS canonical money preserves exact signed64 strings and numeric counters', async () => {
  const exact = '9007199254740993';
  const { pos, calls } = makeClient(() => jsonResponse(202, envelope({ payment: payment({ amountMinor: exact }), replayed: false })));
  await pos.createPayment({ operation: 'SALE', target: { deviceId: DEVICE_ID }, amountMinor: exact, currency: 'KWD',
    items: [{ lineNo: 1, name: 'Exact', quantityMilli: 1000, unitCode: 'C62', unitPriceMinor: exact, taxGroupCode: 'KDV0', lineTotalMinor: exact }] }, KEY);
  const body = bodyOf(calls[0]);
  assert.equal(body.amountMinor, exact);
  assert.equal(body.items[0].unitPriceMinor, exact);
  assert.equal(body.items[0].quantityMilli, 1000);
});

test('physical POS refuses numeric/null/noncanonical money before HTTP including nested and filters', async () => {
  const { pos, calls } = makeClient(() => assert.fail('must not send'));
  for (const invalid of [4500, null, true, '', '01', '1e3', '1.0', ' 1', '1\n', '0', '-1', '9223372036854775808']) {
    await assert.rejects(pos.createPayment({ ...sale(), amountMinor: invalid }, KEY), ConfigurationError);
    await assert.rejects(pos.createReversal(PAYMENT_ID, { operation: 'REFUND', currency: 'TRY', amountMinor: invalid }, KEY), ConfigurationError);
    await assert.rejects(pos.createReversal(PAYMENT_ID, { operation: 'REFUND', currency: 'TRY', items: [{ lineNo: 1, quantityMilli: 1000, amountMinor: invalid }] }, KEY), ConfigurationError);
    await assert.rejects(pos.listTransactions({ amountFromMinor: invalid }), ConfigurationError);
  }
  for (const invalid of [1500, null, '', '0', '1\n', '9223372036854775808']) {
    const request = sale(); request.items[0].unitPriceMinor = invalid;
    await assert.rejects(pos.createPayment(request, KEY), ConfigurationError);
  }
  assert.equal(calls.length, 0);
});

test('a numeric money 2xx payment answer stays unknown instead of becoming a successful write', async () => {
  const { pos, calls } = makeClient(() => jsonResponse(202, envelope({ payment: payment({ amountMinor: 4500 }), replayed: false })));
  await assert.rejects(pos.createPayment(sale(), KEY), error => error instanceof PhysicalPosOutcomeUnknownError && error.idempotencyKey === KEY);
  assert.equal(calls.length, 1);
});
