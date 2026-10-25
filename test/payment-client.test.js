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
  CreateIntentRequest,
  InsuranceItemCategory,
  DirectMethodPaymentRequest,
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

test('3D Secure card payment goes to direct/payment with step-up signature, idempotency, and full business context', async () => {
  const { client, calls } = makeClient();

  await client.payments.directMethodPayment(cardRequest().withForce3D(true), 'idem-card-3d');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/direct/payment');
  assert.equal(call.headers['Idempotency-Key'], 'idem-card-3d');
  assert.ok(call.headers['X-Signature']);
  assert.ok(call.headers.Digest);
  const body = JSON.parse(call.body);
  assert.equal(body.paymentMethod, 'CARD');
  assert.equal(body.force3D, true);
  assert.equal(body.card.cardNumber, '5400000000000004');
  assert.equal(body.buyer.name, 'Ada');
  assert.equal(body.billingAddress.city, 'Istanbul');
  assert.equal(body.basketItems[0].name, 'Demo Product');
});

test('checkout intent carries the basket item insurance fields as given', async () => {
  const { client, calls } = makeClient();
  const insured = {
    id: 'item-1',
    price: 100000,
    name: 'Izmir-Ankara train ticket',
    category1: 'ticket',
    itemType: BasketItem.TYPE_VIRTUAL,
    insuranceCategory: InsuranceItemCategory.TICKET,
    insuranceTypes: ['TICKET_CANCELLATION'],
    insuranceEligible: true,
    insuranceValueAmount: 100000,
    insuranceContext: { transportMode: 'TRAIN', departureAt: '2025-12-23T12:50:00+03:00', isPromotional: false },
  };
  const request = new CreateIntentRequest(150000, 'try', 'order-1').withBasketItems([
    new BasketItem(insured),
    new BasketItem({ id: 'item-2', price: 50000, name: 'Seat reservation', category1: 'ticket', itemType: 'VIRTUAL' }),
  ]);

  await client.payments.createIntent(request, 'checkout:order-1');

  const call = calls.at(-1);
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/intents');
  const body = JSON.parse(call.body);
  assert.deepEqual(body.basketItems[0], insured);
  assert.deepEqual(Object.keys(body.basketItems[1]), ['id', 'price', 'name', 'category1', 'itemType']);
});

test('checkout intent carries the basket item insuranceData as given, one type object per item', async () => {
  const { client, calls } = makeClient();
  // Synthetic values: a made-up passport number, a sample PNR and ticket number.
  const insuranceData = {
    insured: [{ identityType: 'PASSPORT', identityNumber: 'P0000000', birthDate: '2000-01-01', email: 'insured@example.com' }],
    tickets: { carrier: 'Sample Rail', priceAmount: 100000, pnr: 'SAMPLE1', ticketNumber: 'SAMPLE-0001' },
  };
  const insured = {
    id: 'item-1',
    price: 100000,
    name: 'Izmir-Ankara train ticket',
    category1: 'ticket',
    itemType: BasketItem.TYPE_VIRTUAL,
    insuranceCategory: InsuranceItemCategory.TICKET,
    insuranceTypes: ['TICKET_CANCELLATION'],
    insuranceContext: { transportMode: 'TRAIN', departureAt: '2025-12-23T12:50:00+03:00' },
    insuranceData,
  };
  const plain = { id: 'item-2', price: 50000, name: 'Seat reservation', category1: 'ticket', itemType: 'VIRTUAL', insuranceData: null };
  const request = new CreateIntentRequest(150000, 'TRY', 'order-1').withBasketItems([new BasketItem(insured), new BasketItem(plain)]);

  await client.payments.createIntent(request, 'checkout:order-1');

  const body = JSON.parse(calls.at(-1).body);
  assert.deepEqual(body.basketItems[0], insured);
  assert.deepEqual(body.basketItems[0].insuranceData, insuranceData);
  assert.ok(!Array.isArray(body.basketItems[0].insuranceData.tickets), 'tickets is one object for the item');
  assert.equal(body.basketItems[0].insuranceData.tickets.basketItemId, undefined, 'the item id is used, no basketItemId');
  assert.deepEqual(Object.keys(body.basketItems[1]), ['id', 'price', 'name', 'category1', 'itemType'], 'a null insuranceData is left out');
});

test('insurance item categories match the gateway list', () => {
  assert.deepEqual(Object.values(InsuranceItemCategory), [
    'TICKET', 'HOTEL', 'EVENT', 'DEVICE', 'ELECTRONICS', 'VEHICLE', 'TRAVEL', 'HOME', 'HEALTH',
    'PET', 'MICROMOBILITY', 'MUSICAL_INSTRUMENT', 'SHIPMENT', 'EDUCATION',
  ]);
  assert.ok(Object.isFrozen(InsuranceItemCategory));
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

test('a raw card body without paymentMethod is refused before sending', async () => {
  const { client, calls } = makeClient();
  await assert.rejects(
    () => client.payments.directMethodPayment({ amount: 1000, currency: 'TRY', orderId: 'o1', card: { cardNumber: 'x' } }, 'idem'),
    ConfigurationError,
  );
  assert.equal(calls.length, 0);
});

test('webhook verifier matches the v2 raw-body HMAC contract', () => {
  const secret = 'whsec_test';
  const rawBody = '{"type":"payment.captured","id":"evt_1","data":{"b":2,"a":1}}';
  const timestamp = new Date().toISOString();
  const signature = 'v2=' + crypto.createHmac('sha256', secret)
    .update(`evt_1.${timestamp}.${rawBody}`)
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

function cardRequest() {
  return new DirectMethodPaymentRequest(10050, 'TRY', 'ORD-CARD-3D-1')
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
