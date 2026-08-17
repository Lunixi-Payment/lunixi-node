'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  WebhookVerifier,
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  DirectPaymentRequest,
  ConfigurationError,
} = require('../src');
const crypto = require('node:crypto');

function makeClient() {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    return jsonResponse(200, { success: true, data: { id: 'pi_1', status: 'AWAITING_3D' } });
  };

  const client = new LunixiClient({
    baseUrl: 'https://gw.example.com',
    keyId: 'kid_1',
    privateKey: keys.privateKey,
    fetch,
  });
  return { client, calls };
}

test('direct 3D payment sends step-up signature, idempotency, and full business context', async () => {
  const { client, calls } = makeClient();

  await client.payments.chargeCard3d(directRequest(), 'idem-direct-3d');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/direct/3d');
  assert.equal(call.headers['Idempotency-Key'], 'idem-direct-3d');
  assert.ok(call.headers['X-Signature']);
  assert.ok(call.headers.Digest);
  const body = JSON.parse(call.body);
  assert.equal(body.buyer.name, 'Ada');
  assert.equal(body.billingAddress.city, 'Istanbul');
  assert.equal(body.basketItems[0].name, 'Demo Product');
});

test('token request is signed and bodyless', async () => {
  const { client, calls } = makeClient();

  await client.tokens.getToken();

  const call = calls.find((item) => item.url === 'https://gw.example.com/api/v1/auth/token');
  assert.equal(call.method, 'POST');
  assert.equal(call.body, undefined);
  assert.ok(call.headers['X-Key-Id']);
  assert.ok(call.headers['X-Date']);
  assert.ok(call.headers['X-Nonce']);
  assert.ok(call.headers['X-Signature']);
  assert.equal(call.headers['Content-Type'], undefined);
});

test('capture requires caller-provided stable idempotency key', async () => {
  const { client } = makeClient();
  await assert.rejects(() => client.payments.capture('pi_1'), ConfigurationError);
});

test('raw direct card charge rejects card-only payload', async () => {
  const { client } = makeClient();
  await assert.rejects(
    () => client.payments.chargeCard({ paidPrice: 1000, currency: 'TRY', orderId: 'o1', card: { cardNumber: 'x' } }, true, 'idem'),
    ConfigurationError,
  );
});

test('webhook verifier matches stable JSON payload hash contract', () => {
  const secret = 'whsec_test';
  const rawBody = '{"type":"payment.captured","id":"evt_1","data":{"b":2,"a":1}}';
  const timestamp = new Date().toISOString();
  const payloadHash = WebhookVerifier.payloadHash(rawBody);
  const signature = 'sha256=' + crypto.createHmac('sha256', secret)
    .update(`evt_1.${timestamp}.${payloadHash}`)
    .digest('hex');

  const event = new WebhookVerifier(secret).verify(rawBody, {
    'x-lunixi-event-id': 'evt_1',
    'x-lunixi-event-type': 'payment.captured',
    'x-lunixi-signature-timestamp': timestamp,
    'x-lunixi-signature': signature,
  });

  assert.equal(event.id, 'evt_1');
  assert.equal(event.type, 'payment.captured');
  assert.deepEqual(event.data, { b: 2, a: 1 });
});

function directRequest() {
  return new DirectPaymentRequest(
    10050,
    'TRY',
    'ORD-DIRECT-3D-1',
    new CardDetails({
      cardHolderName: 'Ada Yilmaz',
      cardNumber: '5400000000000004',
      expireMonth: '12',
      expireYear: '28',
      cvcNumber: '123',
    }),
    new Buyer({
      name: 'Ada',
      surname: 'Yilmaz',
      identityNumber: '11111111111',
      email: 'ada@example.com',
      gsmNumber: '+905350000000',
      city: 'Istanbul',
      country: 'Turkey',
      zipCode: '34000',
      ip: '127.0.0.1',
    }),
    new Address({
      address: 'Example Street 1',
      zipCode: '34000',
      contactName: 'Ada Yilmaz',
      city: 'Istanbul',
      country: 'Turkey',
    }),
    [
      new BasketItem({
        id: 'SKU-001',
        price: 10050,
        name: 'Demo Product',
        category1: 'Demo',
        itemType: BasketItem.TYPE_PHYSICAL,
      }),
    ],
  );
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}
