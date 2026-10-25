'use strict';

// Split payments: POST /payments/split (create and continue), GET /payments/split[/:id],
// POST /payments/split/:id/refund, GET /payments?includeLegs and the split fields of
// GET /payments/methods. Bodies follow the gateway's SplitPaymentDto /
// RefundSplitPaymentDto (forbidNonWhitelisted).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LunixiClient,
  SplitPaymentRequest,
  PaymentMethod,
  SplitBehavior,
  SplitPaymentStatus,
  SPLIT_PAYMENT_IN_PROGRESS_STATUSES,
  SplitPendingStep,
  SplitPayErrorCode,
  CheckoutFormErrorCode,
  SplitPaymentEvents,
  SPLIT_LEG_EVENTS_SUBSCRIPTION,
  SPLIT_PAYMENT_FIELDS,
  SPLIT_PAYMENT_LEG_FIELDS,
  DIRECT_METHOD_PAYMENT_FIELDS,
  ConfigurationError,
  ValidationError,
  ApiError,
} = require('../src');

const SPLIT_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const LEG_PAYMENT_ID = '9a7d5e3c-1b2a-4f6e-8d0c-7b6a5f4e3d2c';

function makeClient(answer = () => [200, { status: 'success', code: 'SUCCESS', data: {} }]) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    calls.push({ url, ...options });
    const [status, body] = answer(String(url), options);
    return jsonResponse(status, body);
  };
  const client = new LunixiClient({
    baseUrl: 'https://gw.example.com',
    keyId: 'kid_1',
    privateKey: keys.privateKey,
    fetch,
    maxRetries: 0,
  });
  return { client, calls };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}

function cardAndMobileBilling() {
  return new SplitPaymentRequest(100000, 'try', 'cuk_abc123')
    .withOrderId('order-2026-001')
    .withCallbackUrl('https://merchant.example/split-return')
    .addCardLeg('ct_vault_1', 60000, { force3D: true })
    .addMethodLeg(PaymentMethod.MOBILE_BILLING, 'PAYCELL_MOBILE_BILLING', 40000, { gsmNumber: '+905321234567' });
}

function splitData(status, extra = {}) {
  return {
    splitPaymentId: SPLIT_ID,
    status,
    duplicate: false,
    needsReconciliation: false,
    lockContended: false,
    legs: [],
    steps: [],
    pendingStep: null,
    expiresAt: null,
    ...extra,
  };
}

// --- SplitPaymentRequest --------------------------------------------------------------

test('SplitPaymentRequest builds a card leg and a method leg with the direct/payment block', () => {
  assert.deepEqual(cardAndMobileBilling().toJSON(), {
    totalAmount: 100000,
    currency: 'TRY',
    ownerRef: 'cuk_abc123',
    orderId: 'order-2026-001',
    callbackUrl: 'https://merchant.example/split-return',
    legs: [
      { cardToken: 'ct_vault_1', amount: 60000, force3D: true },
      { paymentMethod: 'MOBILE_BILLING', amount: 40000, mobileBilling: { providerCode: 'PAYCELL_MOBILE_BILLING', gsmNumber: '+905321234567' } },
    ],
  });
});

test('every key the builder emits is a gateway DTO field', () => {
  const body = new SplitPaymentRequest(30000, 'TRY', 'cuk_1')
    .addCardLeg('ct_1', 10000, { installment: 3, installmentQuoteToken: 'iq_1' })
    .addMethodLeg(PaymentMethod.WALLET, 'PAYCELL_WALLET', 10000, { gsmNumber: '+905321234567' })
    .addMethodLeg(PaymentMethod.PROMISSORY_NOTE, 'EXAMPLE_PROVIDER', 10000, { noteCount: 3, debtorType: 'INDIVIDUAL' })
    .toJSON();

  assert.deepEqual(Object.keys(body).filter((key) => !SPLIT_PAYMENT_FIELDS.includes(key)), []);
  for (const leg of body.legs) {
    assert.deepEqual(Object.keys(leg).filter((key) => !SPLIT_PAYMENT_LEG_FIELDS.includes(key)), []);
  }
  assert.equal(body.legs[2].promissoryNote.noteCount, '3', 'noteCount is sent as the SELECT option string');
  // The method blocks of a leg are the direct/payment blocks.
  for (const block of ['mobileBilling', 'wallet', 'promissoryNote']) {
    assert.ok(SPLIT_PAYMENT_LEG_FIELDS.includes(block) && DIRECT_METHOD_PAYMENT_FIELDS.includes(block), block);
  }
});

test('the legs must add up to totalAmount', () => {
  const request = new SplitPaymentRequest(100000, 'TRY', 'cuk_1').addCardLeg('ct_1', 60000).addCardLeg('ct_2', 30000);
  assert.throws(() => request.toJSON(), /add up to 90000 but totalAmount is 100000/);
});

test('a method leg needs providerCode and only its own block; card fields stay on card legs', async () => {
  const base = () => new SplitPaymentRequest(10000, 'TRY', 'cuk_1');
  assert.throws(() => base().addMethodLeg(PaymentMethod.MOBILE_BILLING, null, 10000, {}), /providerCode is required/);
  assert.throws(() => base().addMethodLeg(PaymentMethod.CARD, 'X', 10000), /addCardLeg/);
  assert.throws(() => base().addMethodLeg(PaymentMethod.MOBILE_BILLING, 'PAYCELL_MOBILE_BILLING', 10000, { providerCode: 'X' }), ConfigurationError);
  assert.throws(() => base().addMethodLeg(PaymentMethod.BNPL, 'X', 10000), /cannot be a split payment leg/);

  const raw = (leg) => ({ totalAmount: 10000, currency: 'TRY', ownerRef: 'cuk_1', legs: [leg] });
  const { client } = makeClient();
  const refused = [
    { paymentMethod: 'MOBILE_BILLING', amount: 10000, mobileBilling: { gsmNumber: '+905321234567' } },
    { paymentMethod: 'MOBILE_BILLING', amount: 10000, mobileBilling: { providerCode: 'A' }, cardToken: 'ct_1' },
    { paymentMethod: 'MOBILE_BILLING', amount: 10000, mobileBilling: { providerCode: 'A' }, force3D: true },
    { paymentMethod: 'MOBILE_BILLING', amount: 10000, mobileBilling: { providerCode: 'A' }, installment: 2 },
    { paymentMethod: 'MOBILE_BILLING', amount: 10000, mobileBilling: { providerCode: 'A' }, installmentQuoteToken: 'iq' },
    { paymentMethod: 'MOBILE_BILLING', amount: 10000, mobileBilling: { providerCode: 'A' }, wallet: { providerCode: 'B' } },
    { paymentMethod: 'PROMISSORY_NOTE', amount: 10000, promissoryNote: { providerCode: 'A', schedule: [{ amount: 10000, dueDate: '2030-01-15' }] } },
    { paymentMethod: 'PROMISSORY_NOTE', amount: 10000, promissoryNote: { providerCode: 'A' } },
    { amount: 10000 },
    { cardToken: 'ct_1', amount: 10000, mobileBilling: { providerCode: 'A' } },
    { cardToken: 'ct_1', amount: 10000, installment: 2 },
    { cardToken: 'ct_1', amount: 10000, installment: 37, installmentQuoteToken: 'iq' },
    { cardToken: 'ct_1', amount: 10000.5 },
    { cardToken: 'ct_1', amount: 10000, price: 10000 },
  ];
  for (const leg of refused) {
    await assert.rejects(client.payments.createSplitPayment(raw(leg), 'split-k'), ConfigurationError, JSON.stringify(leg));
  }
});

test('one leg per provider and one leg per card', () => {
  assert.throws(
    () => new SplitPaymentRequest(20000, 'TRY', 'cuk_1')
      .addMethodLeg(PaymentMethod.WALLET, 'PAYCELL_WALLET', 10000)
      .addMethodLeg(PaymentMethod.WALLET, 'PAYCELL_WALLET', 10000)
      .toJSON(),
    /one leg per provider/,
  );
  assert.throws(
    () => new SplitPaymentRequest(20000, 'TRY', 'cuk_1').addCardLeg('ct_1', 10000).addCardLeg('ct_1', 10000).toJSON(),
    /same card/,
  );
});

test('3D Secure on a card leg needs callbackUrl; 1 to 5 legs', () => {
  assert.throws(
    () => new SplitPaymentRequest(10000, 'TRY', 'cuk_1').addCardLeg('ct_1', 10000, { force3D: true }).toJSON(),
    /callbackUrl is required/,
  );
  assert.throws(() => new SplitPaymentRequest(10000, 'TRY', 'cuk_1').toJSON(), /1 to 5 legs/);
  const six = new SplitPaymentRequest(6000, 'TRY', 'cuk_1');
  for (let i = 0; i < 6; i += 1) six.addCardLeg(`ct_${i}`, 1000);
  assert.throws(() => six.toJSON(), /1 to 5 legs/);
});

// --- payments.createSplitPayment ------------------------------------------------------

test('createSplitPayment is a signed, keyed POST /payments/split', async () => {
  const { client, calls } = makeClient(() => [200, { status: 'success', code: 'COMPLETED', data: splitData('COMPLETED') }]);

  const response = await client.payments.createSplitPayment(cardAndMobileBilling(), 'split:order-2026-001');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/split');
  assert.equal(call.headers['Idempotency-Key'], 'split:order-2026-001');
  assert.ok(call.headers['X-Signature']);
  assert.ok(call.headers.Digest);
  assert.equal(JSON.parse(call.body).legs.length, 2);
  assert.equal(response.data.status, SplitPaymentStatus.COMPLETED);
});

test('createSplitPayment refuses to send without an Idempotency-Key or with a key the gateway refuses', async () => {
  const { client, calls } = makeClient();
  await assert.rejects(client.payments.createSplitPayment(cardAndMobileBilling()), /Idempotency-Key is required/);
  await assert.rejects(client.payments.createSplitPayment(cardAndMobileBilling(), '  '), ConfigurationError);
  await assert.rejects(client.payments.createSplitPayment(cardAndMobileBilling(), 'k'.repeat(201)), /at most 200/);
  assert.equal(calls.length, 0);
});

test('a running split payment (HTTP 400 with the status as code) is returned, not thrown', async () => {
  const pendingStep = {
    legId: 'leg-2',
    sequence: 2,
    step: SplitPendingStep.ACTION,
    paymentMethod: 'MOBILE_BILLING',
    providerCode: 'PAYCELL_MOBILE_BILLING',
    amount: 40000,
    paymentId: LEG_PAYMENT_ID,
    actionId: 'act_1',
    redirectPath: null,
    action: { id: 'act_1', type: 'OTP', status: 'OPEN', expiresAt: '2026-10-18T13:03:00.000Z' },
  };
  for (const status of SPLIT_PAYMENT_IN_PROGRESS_STATUSES) {
    const { client } = makeClient(() => [400, {
      status: 'failure',
      code: status,
      message: 'SplitPay bir bacakta bekliyor.',
      statusCode: 400,
      data: splitData(status, { pendingStep }),
    }]);
    const response = await client.payments.createSplitPayment(cardAndMobileBilling(), 'split-k');
    assert.equal(response.data.status, status);
    assert.equal(response.data.pendingStep.paymentId, LEG_PAYMENT_ID);
  }
});

test('a failed split payment and a rule violation still throw', async () => {
  for (const status of [SplitPaymentStatus.VOIDED, SplitPaymentStatus.FAILED, SplitPaymentStatus.COMPENSATING, SplitPaymentStatus.RECONCILIATION_REQUIRED]) {
    const { client } = makeClient(() => [400, { status: 'failure', code: status, statusCode: 400, data: splitData(status) }]);
    await assert.rejects(
      client.payments.createSplitPayment(cardAndMobileBilling(), 'split-k'),
      (error) => error instanceof ValidationError && error.code === status && error.response.data.splitPaymentId === SPLIT_ID,
    );
  }
  const { client } = makeClient(() => [422, {
    status: 'failure',
    code: SplitPayErrorCode.MULTIPLE_IRREVERSIBLE_LEGS,
    statusCode: 422,
    data: null,
  }]);
  await assert.rejects(
    client.payments.createSplitPayment(cardAndMobileBilling(), 'split-k'),
    (error) => error instanceof ApiError && error.statusCode === 422 && error.code === 'split_pay.validation.multiple_irreversible_legs',
  );
  // A 400 whose code is a running status but whose body is not a split payment is not swallowed.
  const odd = makeClient(() => [400, { status: 'failure', code: 'AWAITING_ACTION', data: {} }]);
  await assert.rejects(odd.client.payments.createSplitPayment(cardAndMobileBilling(), 'split-k'), ValidationError);
});

test('continuing is the same request with the same key', async () => {
  const keys = [];
  const bodies = [];
  const { client } = makeClient((url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    bodies.push(options.body);
    return [200, { status: 'success', code: 'COMPLETED', data: splitData('COMPLETED', { duplicate: true }) }];
  });
  const request = cardAndMobileBilling();
  await client.payments.createSplitPayment(request, 'split:order-2026-001');
  await client.payments.createSplitPayment(request, 'split:order-2026-001');
  assert.deepEqual(keys, ['split:order-2026-001', 'split:order-2026-001']);
  assert.equal(bodies[0], bodies[1]);
});

// --- read and refund --------------------------------------------------------------------

test('getSplitPayment and listSplitPayments are bearer GETs; list filters repeat', async () => {
  const { client, calls } = makeClient(() => [200, { status: 'success', code: 'SUCCESS', data: { items: [], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: null } }]);

  await client.payments.getSplitPayment(SPLIT_ID);
  assert.equal(calls.at(-1).url, `https://gw.example.com/api/v1/payments/split/${SPLIT_ID}`);
  assert.equal(calls.at(-1).method, 'GET');
  assert.equal(calls.at(-1).headers['X-Signature'], undefined);

  await client.payments.listSplitPayments({ status: ['COMPLETED', 'VOIDED'], currency: 'TRY', limit: 10, after: 'cur/1' });
  assert.equal(calls.at(-1).url, 'https://gw.example.com/api/v1/payments/split?status=COMPLETED&status=VOIDED&currency=TRY&limit=10&after=cur%2F1');

  await client.payments.listSplitPayments();
  assert.equal(calls.at(-1).url, 'https://gw.example.com/api/v1/payments/split');

  for (const filters of [{ status: 'DONE' }, { limit: 0 }, { limit: 101 }, { currency: 'try' }, { page: 2 }, { createdFrom: 'yesterday' }]) {
    assert.throws(() => client.payments.listSplitPayments(filters), ConfigurationError, JSON.stringify(filters));
  }
  assert.throws(() => client.payments.getSplitPayment(''), ConfigurationError);
});

test('refundSplitPayment is a signed, keyed POST with amount and reason only', async () => {
  const { client, calls } = makeClient(() => [200, { status: 'success', code: 'SPLIT_REFUND_COMPLETED', data: { status: 'COMPLETED', legs: [] } }]);

  await client.payments.refundSplitPayment(SPLIT_ID, 1500, 'Customer return', 'refund:order-2026-001:1');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `https://gw.example.com/api/v1/payments/split/${SPLIT_ID}/refund`);
  assert.deepEqual(JSON.parse(call.body), { amount: 1500, reason: 'Customer return' });
  assert.equal(call.headers['Idempotency-Key'], 'refund:order-2026-001:1');
  assert.ok(call.headers['X-Signature']);

  await assert.rejects(client.payments.refundSplitPayment(SPLIT_ID, 1500), /Idempotency-Key is required/);
  await assert.rejects(client.payments.refundSplitPayment(SPLIT_ID, 0, null, 'k'), ConfigurationError);
  await assert.rejects(client.payments.refundSplitPayment(SPLIT_ID, 15.5, null, 'k'), ConfigurationError);
  await assert.rejects(client.payments.refundSplitPayment(SPLIT_ID, 100, 'x'.repeat(501), 'k'), ConfigurationError);
});

test('an incomplete refund throws with the per-leg result', async () => {
  const { client } = makeClient(() => [400, {
    status: 'failure',
    code: SplitPayErrorCode.REFUND_INCOMPLETE,
    statusCode: 400,
    data: { status: 'PARTIAL', legs: [{ legId: 'l1', status: 'SUCCEEDED' }, { legId: 'l2', status: 'FAILED', errorCode: 'payment.refund.provider_error' }] },
  }]);
  await assert.rejects(
    client.payments.refundSplitPayment(SPLIT_ID, 1500, null, 'k'),
    (error) => error instanceof ValidationError && error.code === 'split_pay.refund.incomplete' && error.response.data.legs.length === 2,
  );
});

test('payments.list sends includeLegs as a boolean query value', async () => {
  const { client, calls } = makeClient(() => [200, { data: [] }]);
  await client.payments.list({ limit: 10, includeLegs: true });
  assert.equal(calls.at(-1).url, 'https://gw.example.com/api/v1/payments?limit=10&includeLegs=true');
  await client.payments.list({ limit: 10 });
  assert.equal(calls.at(-1).url, 'https://gw.example.com/api/v1/payments?limit=10');
  assert.throws(() => client.payments.list({ includeLegs: 'yes' }), ConfigurationError);
});

// --- value sets ----------------------------------------------------------------------------

test('value sets match the gateway', () => {
  assert.deepEqual(Object.values(SplitBehavior), ['APPROVE_THEN_DISBURSE', 'HOLD_CAPTURE', 'CAPTURE_REVERSIBLE', 'CAPTURE_IRREVERSIBLE']);
  assert.equal(Object.values(SplitPaymentStatus).length, 13);
  assert.deepEqual(Object.values(SplitPendingStep), ['THREE_DS', 'START_METHOD', 'ACTION', 'RESULT_PENDING', 'CREDIT_APPROVAL', 'CARD_INPUT', 'REPLACEMENT_CARD']);
  assert.equal(SPLIT_LEG_EVENTS_SUBSCRIPTION, 'payment.split.leg_events');
  assert.equal(Object.values(SplitPaymentEvents).includes(SPLIT_LEG_EVENTS_SUBSCRIPTION), false, 'the leg option is not an event type');
  for (const code of Object.values(SplitPayErrorCode)) assert.match(code, /^split_pay\.[a-z_]+\.[a-z_]+$/);
  assert.deepEqual(Object.values(CheckoutFormErrorCode), [
    'payment.provider.disabled_in_form',
    'payment.method.selection_attempts_exhausted',
    'payment.checkout.order_locked',
  ]);
  assert.deepEqual(SPLIT_PAYMENT_FIELDS, ['totalAmount', 'currency', 'ownerRef', 'legs', 'orderId', 'ownerScope', 'callbackUrl']);
});

test('index.d.ts declares exactly the methods SplitPaymentRequest and the split client calls have', () => {
  const typings = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  const block = typings.match(/export class SplitPaymentRequest \{([\s\S]*?)\n\}/);
  assert.ok(block, 'SplitPaymentRequest is declared');
  const declared = new Set([...block[1].matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]).filter((key) => key !== 'constructor'));
  const actual = new Set(Object.getOwnPropertyNames(SplitPaymentRequest.prototype).filter((key) => key !== 'constructor'));
  assert.deepEqual([...actual].filter((key) => !declared.has(key)).sort(), [], 'runtime methods missing from index.d.ts');
  assert.deepEqual([...declared].filter((key) => !actual.has(key)).sort(), [], 'declared methods missing at runtime');

  const { client } = makeClient();
  for (const method of ['createSplitPayment', 'getSplitPayment', 'listSplitPayments', 'refundSplitPayment']) {
    assert.equal(typeof client.payments[method], 'function', `payments.${method}`);
    assert.match(typings, new RegExp(`\\b${method}\\(`), `index.d.ts declares ${method}`);
  }
  assert.match(typings, /splitEligible: boolean;/);
  assert.match(typings, /splitBehavior: SplitBehaviorValue \| null;/);
});
