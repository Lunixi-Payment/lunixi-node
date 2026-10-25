'use strict';

// Amount contract of the payment bodies (gateway K17): `amount` is the only amount
// field of POST /payments/intents, /payments/marketplace/intents,
// /payments/marketplace/2d|3d and /payments/direct/payment (card included). `price` and `paidPrice` were
// removed; the gateway answers them with 400 `payment.amount.field_removed`, so the SDK
// refuses them before anything is sent. A basket item keeps its own `price`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LunixiClient,
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectMethodPaymentRequest,
  PaymentMethod,
  DIRECT_METHOD_PAYMENT_FIELDS,
  REMOVED_AMOUNT_FIELDS,
  ConfigurationError,
} = require('../src');

const AMOUNT_BUILDERS = ['CreateIntentRequest', 'DirectMethodPaymentRequest'];
const INVALID_AMOUNTS = [0, -1, 100.5, '10050', null, undefined, Number.NaN, Number.MAX_SAFE_INTEGER + 1];

function makeClient() {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    calls.push({ url: String(url), ...options });
    return jsonResponse(200, { status: 'success', code: 'SUCCESS', data: { token: 'tok_1', paymentId: 'pi_1' } });
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

function card() {
  return new CardDetails({
    cardHolderName: 'Ada Yilmaz',
    cardNumber: '5400000000000004',
    expireMonth: '12',
    expireYear: '28',
    cvcNumber: '123',
  });
}

function basket(amount) {
  return [new BasketItem({ id: 'SKU-001', price: amount, name: 'Demo Product', category1: 'Demo', itemType: BasketItem.TYPE_PHYSICAL })];
}

/** A card charge through direct/payment (the only server-side card charge). */
function cardRequest(amount = 10050) {
  return new DirectMethodPaymentRequest(amount, 'TRY', 'ORD-AMT-1')
    .withCard(card())
    .withBuyer(new Buyer({ name: 'Ada', surname: 'Yilmaz' }))
    .withBillingAddress(new Address({ city: 'Istanbul' }))
    .withBasketItems(basket(amount));
}

// --- Builders ---------------------------------------------------------------------

test('every builder sends amount and never price / paidPrice', () => {
  const bodies = {
    intent: new CreateIntentRequest(10050, 'TRY', 'ORD-AMT-1').withBasketItems(basket(10050)).toJSON(),
    methodCard: cardRequest().toJSON(),
    methodMobileBilling: new DirectMethodPaymentRequest(10050, 'TRY', 'ORD-AMT-1')
      .withMethodFields(PaymentMethod.MOBILE_BILLING, null, { gsmNumber: '+905321234567' })
      .toJSON(),
  };

  for (const [name, body] of Object.entries(bodies)) {
    assert.equal(body.amount, 10050, `${name}: amount`);
    for (const field of REMOVED_AMOUNT_FIELDS) assert.equal(Object.prototype.hasOwnProperty.call(body, field), false, `${name}: ${field}`);
  }
  assert.equal(bodies.intent.basketItems[0].price, 10050, 'a basket item keeps its own price');
  assert.equal(bodies.methodCard.basketItems[0].price, 10050, 'a basket item keeps its own price');
});

test('the removed amount setters are gone', () => {
  for (const [name, Builder] of [['CreateIntentRequest', CreateIntentRequest], ['DirectMethodPaymentRequest', DirectMethodPaymentRequest]]) {
    for (const method of ['withPrice', 'withPaidPrice']) {
      assert.equal(typeof Builder.prototype[method], 'undefined', `${name}.${method}`);
    }
  }
  // The intent has no installment field any more (gateway: 400); the buyer picks it on the form.
  assert.equal(typeof CreateIntentRequest.prototype.withInstallment, 'undefined');
});

test('amount is a positive integer in minor units on every builder', () => {
  for (const amount of INVALID_AMOUNTS) {
    const label = String(amount);
    assert.throws(() => new CreateIntentRequest(amount, 'TRY', 'O'), ConfigurationError, `intent ${label}`);
    assert.throws(() => new DirectMethodPaymentRequest(amount, 'TRY', 'O'), ConfigurationError, `direct/payment ${label}`);
  }
  assert.equal(new CreateIntentRequest(1, 'TRY', 'O').toJSON().amount, 1, 'one minor unit is the smallest amount');
});

test('a card direct/payment carries installment and the installment quote token', () => {
  const body = cardRequest(15000).withInstallment(3, 'iq_1').toJSON();

  assert.equal(body.amount, 15000, 'amount stays the basket total; the system adds the installment fee');
  assert.equal(body.installment, 3);
  assert.equal(body.installmentQuoteToken, 'iq_1');

  const withoutQuote = cardRequest().withInstallment(2).toJSON();
  assert.equal(withoutQuote.installment, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutQuote, 'installmentQuoteToken'), false);

  for (const count of [1.5, '3', null]) {
    assert.throws(() => cardRequest().withInstallment(count, 'iq_1'), ConfigurationError, String(count));
  }
  for (const token of ['', '   ', 7]) {
    assert.throws(() => cardRequest().withInstallment(3, token), ConfigurationError, JSON.stringify(token));
  }
});

test('the direct/payment field list carries amount and none of the removed fields', () => {
  assert.deepEqual([...REMOVED_AMOUNT_FIELDS], ['price', 'paidPrice']);
  assert.ok(Object.isFrozen(REMOVED_AMOUNT_FIELDS));
  assert.ok(DIRECT_METHOD_PAYMENT_FIELDS.includes('amount'));
  assert.deepEqual(REMOVED_AMOUNT_FIELDS.filter((field) => DIRECT_METHOD_PAYMENT_FIELDS.includes(field)), []);
});

// --- Raw bodies are refused before sending ------------------------------------------------

test('a raw body with price or paidPrice is refused before anything is sent', async () => {
  const { client, calls } = makeClient();
  const intent = new CreateIntentRequest(10050, 'TRY', 'ORD-AMT-1').toJSON();
  const marketplace = { ...intent, sellers: [{ subDealerId: 'd_1', amountMinor: '10050' }], multiSellerPolicy: 'ALL_OR_NOTHING' };
  const methodCard = cardRequest().toJSON();
  const method = new DirectMethodPaymentRequest(10050, 'TRY', 'ORD-AMT-1')
    .withMethodFields(PaymentMethod.MOBILE_BILLING, null, { gsmNumber: '+905321234567' })
    .toJSON();

  const sends = {
    createIntent: (body) => client.payments.createIntent(body, 'k-intent'),
    createMarketplaceIntent: (body) => client.payments.createMarketplaceIntent(body, 'k-mp'),
    directMethodPaymentCard: (body) => client.payments.directMethodPayment(body, 'k-card'),
    directMethodPayment: (body) => client.payments.directMethodPayment(body, 'k-method'),
  };
  const bases = { createIntent: intent, createMarketplaceIntent: marketplace, directMethodPaymentCard: methodCard, directMethodPayment: method };

  for (const [operation, send] of Object.entries(sends)) {
    for (const extra of [{ price: 10050 }, { paidPrice: 10050 }, { price: 10050, paidPrice: 10050 }, { paidPrice: null }, { price: '10050' }]) {
      await assert.rejects(
        () => send({ ...bases[operation], ...extra }),
        (error) => error instanceof ConfigurationError && /removed/.test(error.message) && /'amount'/.test(error.message),
        `${operation} ${JSON.stringify(extra)}`,
      );
    }
  }
  assert.equal(calls.length, 0, 'nothing reached the gateway');

  // The same bodies without the removed fields are sent unchanged.
  for (const [operation, send] of Object.entries(sends)) await send(bases[operation]);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/api/v1/payments/intents',
    '/api/v1/payments/marketplace/intents',
    '/api/v1/payments/direct/payment',
    '/api/v1/payments/direct/payment',
  ]);
  for (const call of calls) {
    const body = JSON.parse(call.body);
    assert.equal(body.amount, 10050);
    for (const field of REMOVED_AMOUNT_FIELDS) assert.equal(Object.prototype.hasOwnProperty.call(body, field), false);
  }
});

test('a raw direct card body without amount is refused before sending', async () => {
  const { client, calls } = makeClient();
  const { amount, ...withoutAmount } = cardRequest().toJSON();

  assert.equal(amount, 10050);
  await assert.rejects(() => client.payments.directMethodPayment(withoutAmount, 'k-card'), /require 'amount'/);
  assert.equal(calls.length, 0);
});

// --- Typings follow the runtime ----------------------------------------------------------

test('index.d.ts declares exactly the setters the amount builders have', () => {
  const typings = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  const runtime = require('../src');

  for (const name of AMOUNT_BUILDERS) {
    const block = typings.match(new RegExp(`export class ${name} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(block, `${name} is declared`);
    const declared = new Set([...block[1].matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]).filter((key) => key !== 'constructor'));
    const actual = new Set(Object.getOwnPropertyNames(runtime[name].prototype).filter((key) => key !== 'constructor'));
    assert.deepEqual([...actual].filter((key) => !declared.has(key)).sort(), [], `${name}: runtime methods missing from index.d.ts`);
    assert.deepEqual([...declared].filter((key) => !actual.has(key)).sort(), [], `${name}: declared methods missing at runtime`);
    assert.match(block[1], /constructor\(\s*amount: number/, `${name}: the first constructor argument is amount`);
    assert.doesNotMatch(block[1], /paidPrice|withPrice/, `${name}: no removed amount field in the typings`);
  }
  assert.match(typings, /export class DirectMethodPaymentRequest \{[\s\S]*?withInstallment\(value: number, quoteToken\?: string \| null\): this;/);
  assert.match(typings, /export const REMOVED_AMOUNT_FIELDS: readonly \['price', 'paidPrice'\];/);
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}
