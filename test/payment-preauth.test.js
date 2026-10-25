'use strict';

// Pre-authorization is the typed `preauth` body field. No SDK path writes
// `metadata.autoCapture`.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectMethodPaymentRequest,
  ConfigurationError,
} = require('../src');

function makeClient() {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    return jsonResponse(200, { success: true, data: { id: 'pi_1', status: 'AUTHORIZED' } });
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

test('intent: withPreauth(true) writes the typed field and nothing into metadata', () => {
  const body = new CreateIntentRequest(10050, 'TRY', 'ORD-PRE-1')
    .withMetadata({ order: 'ORD-PRE-1' })
    .withPreauth(true)
    .toJSON();

  assert.equal(body.preauth, true);
  assert.deepEqual(body.metadata, { order: 'ORD-PRE-1' });
});

test('intent: withPreauth(false) is kept on the wire as an explicit false', () => {
  const body = new CreateIntentRequest(10050, 'TRY', 'ORD-PRE-2').withPreauth(false).toJSON();

  assert.equal(body.preauth, false);
  assert.equal(body.metadata, undefined);
});

test('intent without withPreauth sends no preauth field', () => {
  const body = new CreateIntentRequest(10050, 'TRY', 'ORD-PRE-3').toJSON();

  assert.equal(Object.prototype.hasOwnProperty.call(body, 'preauth'), false);
});

test('withPreauth refuses anything but a boolean', () => {
  for (const value of ['false', 'true', 0, 1, null, undefined, {}]) {
    assert.throws(() => new CreateIntentRequest(10050, 'TRY', 'ORD-PRE-4').withPreauth(value), ConfigurationError);
    assert.throws(() => cardRequest().withPreauth(value), ConfigurationError);
  }
});

test('createIntent sends preauth: true to POST /payments/intents', async () => {
  const { client, calls } = makeClient();

  await client.payments.createIntent(
    new CreateIntentRequest(10050, 'TRY', 'ORD-PRE-5').withPreauth(true),
    'idem-intent-pre',
  );

  const [call] = gatewayCalls(calls);
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/intents');
  const body = JSON.parse(call.body);
  assert.equal(body.preauth, true);
  assert.equal(body.metadata, undefined);
});

test('createMarketplaceIntent carries the same typed preauth field', async () => {
  const { client, calls } = makeClient();

  await client.payments.createMarketplaceIntent(
    new CreateIntentRequest(10050, 'TRY', 'ORD-PRE-6').withPreauth(true),
    'idem-mp-pre',
  );

  const [call] = gatewayCalls(calls);
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/marketplace/intents');
  const body = JSON.parse(call.body);
  assert.equal(body.preauth, true);
  assert.equal(body.metadata, undefined);
});

for (const [label, force3D] of [['card', false], ['3D Secure card', true]]) {
  test(`${label} sends preauth: true to POST /payments/direct/payment`, async () => {
    const { client, calls } = makeClient();
    const request = cardRequest().withPreauth(true);
    if (force3D) request.withForce3D(true);

    await client.payments.directMethodPayment(request, `idem-${label}`);

    const [call] = gatewayCalls(calls);
    assert.equal(call.url, 'https://gw.example.com/api/v1/payments/direct/payment');
    const body = JSON.parse(call.body);
    assert.equal(body.paymentMethod, 'CARD');
    assert.equal(body.preauth, true);
    assert.equal(body.metadata, undefined);
  });
}

test('raw card directMethodPayment refuses a non-boolean preauth before any request', async () => {
  const { client, calls } = makeClient();
  const payload = { ...cardRequest().toJSON(), preauth: 'false' };

  await assert.rejects(() => client.payments.directMethodPayment(payload, 'idem-raw'), ConfigurationError);
  assert.equal(gatewayCalls(calls).length, 0);
});

test('raw card directMethodPayment passes a boolean preauth through unchanged', async () => {
  const { client, calls } = makeClient();
  const payload = { ...cardRequest().toJSON(), preauth: true, force3D: true };

  await client.payments.directMethodPayment(payload, 'idem-raw-ok');

  const [call] = gatewayCalls(calls);
  assert.equal(JSON.parse(call.body).preauth, true);
});

function cardRequest() {
  return new DirectMethodPaymentRequest(10050, 'TRY', 'ORD-CARD-PRE-1')
    .withCard(new CardDetails({
      cardHolderName: 'Ada Yilmaz',
      cardNumber: '5400000000000004',
      expireMonth: '12',
      expireYear: '28',
      cvcNumber: '123',
    }))
    .withBuyer(new Buyer({
      name: 'Ada',
      surname: 'Yilmaz',
      identityNumber: '11111111111',
      email: 'ada@example.com',
      gsmNumber: '+905350000000',
      city: 'Istanbul',
      country: 'Turkey',
      zipCode: '34000',
      ip: '127.0.0.1',
    }))
    .withBillingAddress(new Address({
      address: 'Example Street 1',
      zipCode: '34000',
      contactName: 'Ada Yilmaz',
      city: 'Istanbul',
      country: 'Turkey',
    }))
    .withBasketItems([
      new BasketItem({
        id: 'SKU-001',
        price: 10050,
        name: 'Demo Product',
        category1: 'Demo',
        itemType: BasketItem.TYPE_PHYSICAL,
      }),
    ]);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}
