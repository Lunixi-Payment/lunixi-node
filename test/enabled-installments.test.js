'use strict';

// `enabledInstallments` narrows the installment counts of one payment. Broken
// lists are refused before any request; a valid list is sent in ascending order.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  CreateIntentRequest,
  InstallmentOptionsRequest,
  CreatePaymentLinkRequest,
  PaymentLinkUsage,
  ConfigurationError,
} = require('../src');
const { requireEnabledInstallments } = require('../src/payment/dto');

function makeClient() {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    return jsonResponse(200, { success: true, data: { token: 'tok_1', paymentId: 'pi_1' } });
  };
  const client = new LunixiClient({
    baseUrl: 'https://gw.example.com',
    keyId: 'kid_1',
    privateKey: keys.privateKey,
    fetch,
  });
  return { client, calls };
}

function gatewayCalls(calls) {
  return calls.filter((call) => !String(call.url).endsWith('/api/v1/auth/token'));
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}

const INVALID_LISTS = [
  ['empty', []],
  ['without 1', [2, 3]],
  ['duplicate', [1, 2, 2]],
  ['zero', [0, 1]],
  ['negative', [1, -3]],
  ['above 36', [1, 37]],
  ['fraction', [1, 2.5]],
  ['string', [1, '3']],
  ['null entry', [1, null]],
  ['boolean', [true, 2]],
  ['not an array', '1,2,3'],
  ['null', null],
];

test('intent: the list is sent in ascending order', () => {
  const body = new CreateIntentRequest('10050', 'TRY', 'ORD-INS-1').withEnabledInstallments([3, 1, 2]).toJSON();

  assert.deepEqual(body.enabledInstallments, [1, 2, 3]);
});

test('intent: [1] means a single payment only', () => {
  const body = new CreateIntentRequest('10050', 'TRY', 'ORD-INS-2').withEnabledInstallments([1]).toJSON();

  assert.deepEqual(body.enabledInstallments, [1]);
});

test('intent without withEnabledInstallments sends no field', () => {
  const body = new CreateIntentRequest('10050', 'TRY', 'ORD-INS-3').toJSON();

  assert.equal(Object.prototype.hasOwnProperty.call(body, 'enabledInstallments'), false);
});

test('the caller array is not reordered in place', () => {
  const counts = [6, 1, 3];
  new CreateIntentRequest('10050', 'TRY', 'ORD-INS-4').withEnabledInstallments(counts);

  assert.deepEqual(counts, [6, 1, 3]);
});

for (const [label, counts] of INVALID_LISTS) {
  test(`a broken list is refused: ${label}`, () => {
    assert.throws(() => requireEnabledInstallments(counts), ConfigurationError);
    assert.throws(() => new CreateIntentRequest('10050', 'TRY', 'ORD-INS-5').withEnabledInstallments(counts), ConfigurationError);
    assert.throws(() => new InstallmentOptionsRequest('10050', 'TRY').withEnabledInstallments(counts), ConfigurationError);
  });
}

test('a duplicate is an error, not removed', () => {
  assert.throws(() => requireEnabledInstallments([1, 3, 3]), /more than once/);
});

test('1 and 36 are the bounds', () => {
  assert.deepEqual(requireEnabledInstallments([36, 1]), [1, 36]);
});

test('createIntent sends the sorted list to POST /payments/intents', async () => {
  const { client, calls } = makeClient();

  await client.payments.createIntent(
    new CreateIntentRequest('10050', 'TRY', 'ORD-INS-6').withEnabledInstallments([3, 2, 1]),
    'idem-intent-installments',
  );

  const [call] = gatewayCalls(calls);
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/intents');
  assert.deepEqual(JSON.parse(call.body).enabledInstallments, [1, 2, 3]);
});

test('raw createIntent body: a broken list is refused before any request', async () => {
  const { client, calls } = makeClient();
  const payload = { ...new CreateIntentRequest('10050', 'TRY', 'ORD-INS-7').toJSON(), enabledInstallments: [] };

  await assert.rejects(() => client.payments.createIntent(payload, 'idem-raw-installments'), ConfigurationError);
  assert.equal(gatewayCalls(calls).length, 0);
});

test('raw createIntent body: a valid list is sent sorted without changing the caller object', async () => {
  const { client, calls } = makeClient();
  const payload = { ...new CreateIntentRequest('10050', 'TRY', 'ORD-INS-8').toJSON(), enabledInstallments: [6, 1] };

  await client.payments.createIntent(payload, 'idem-raw-installments-ok');

  assert.deepEqual(JSON.parse(gatewayCalls(calls)[0].body).enabledInstallments, [1, 6]);
  assert.deepEqual(payload.enabledInstallments, [6, 1]);
});

test('installmentOptions sends the sorted list to POST /bin/installments', async () => {
  const { client, calls } = makeClient();

  await client.payments.installmentOptions(new InstallmentOptionsRequest('10050', 'TRY').withEnabledInstallments([3, 1]));

  const [call] = gatewayCalls(calls);
  assert.equal(call.url, 'https://gw.example.com/api/v1/bin/installments');
  assert.deepEqual(JSON.parse(call.body).enabledInstallments, [1, 3]);
});

test('raw installmentOptions body: a list without 1 is refused before any request', async () => {
  const { client, calls } = makeClient();

  assert.throws(() => client.payments.installmentOptions({ amount: '10050', currency: 'TRY', enabledInstallments: [2, 3] }), ConfigurationError);
  assert.equal(gatewayCalls(calls).length, 0);
});

test('payment link checkout: the list is sent sorted', () => {
  const body = CreatePaymentLinkRequest.fixed(PaymentLinkUsage.SINGLE_USE, '150000', 'TRY', 'Fee')
    .withCheckout({ enabledInstallments: [3, 1] })
    .toJSON();

  assert.deepEqual(body.checkout, { requireThreeDs: false, paymentMethods: [], enabledInstallments: [1, 3] });
});

test('payment link checkout: an empty list means no restriction and is not sent', () => {
  const body = CreatePaymentLinkRequest.fixed(PaymentLinkUsage.SINGLE_USE, '150000', 'TRY', 'Fee')
    .withCheckout({ requireThreeDs: true, enabledInstallments: [] })
    .toJSON();

  assert.equal(Object.prototype.hasOwnProperty.call(body.checkout, 'enabledInstallments'), false);
});

test('payment link checkout: a broken list is refused', () => {
  assert.throws(
    () => CreatePaymentLinkRequest.fixed(PaymentLinkUsage.SINGLE_USE, '150000', 'TRY', 'Fee')
      .withCheckout({ enabledInstallments: [2, 4] }),
    /checkout\.enabledInstallments/,
  );
});
