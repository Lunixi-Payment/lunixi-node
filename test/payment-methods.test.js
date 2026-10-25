'use strict';

// Payment-method endpoints: POST /payments/direct/payment, the action endpoint
// (confirm / resend) and GET /payments/methods. Bodies follow the gateway's
// DirectMethodPaymentDto / ConfirmPaymentActionDto (forbidNonWhitelisted).

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
  DirectMethodPaymentRequest,
  PaymentMethod,
  PaymentActionType,
  ProviderSelection,
  ProviderSelectionMode,
  DIRECT_METHOD_PAYMENT_FIELDS,
  PAYMENT_ACTION_CONFIRM_FIELDS,
  ConfigurationError,
  ValidationError,
  ApiError,
} = require('../src');

const PAYMENT_ID = '3f1c2a9e-5b7d-4c1e-9a2b-6d8e0f1a2b3c';

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

function mobileBillingRequest() {
  return new DirectMethodPaymentRequest(5000, 'try', 'ORD-MB-1')
    .withMethodFields(PaymentMethod.MOBILE_BILLING, null, { gsmNumber: '+905321234567' })
    .withCallbackUrl('https://merchant.example.com/payment/callback');
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

function otpAnswer(actionId = 'act_1') {
  return [202, {
    status: 'partial',
    code: 'payment.action.required',
    statusCode: 202,
    data: {
      paymentId: PAYMENT_ID,
      orderId: 'ORD-MB-1',
      status: 'INITIATED',
      paymentMethod: 'MOBILE_BILLING',
      providerCode: 'PAYCELL_MOBILE_BILLING',
      action: { id: actionId, type: 'OTP', expiresAt: '2026-10-11T10:05:00.000Z', otp: { maskedTarget: '+90532***4567' } },
    },
  }];
}

// --- DirectMethodPaymentRequest ------------------------------------------------

test('withMethodFields writes paymentMethod and only the method block', () => {
  const body = mobileBillingRequest().toJSON();

  assert.deepEqual(body, {
    paymentMethod: 'MOBILE_BILLING',
    amount: 5000,
    currency: 'TRY',
    orderId: 'ORD-MB-1',
    callbackUrl: 'https://merchant.example.com/payment/callback',
    mobileBilling: { gsmNumber: '+905321234567' },
  });
});

test('providerCode goes into the block; amount is the only amount field', () => {
  const body = new DirectMethodPaymentRequest(12500, 'TRY', 'ORD-W-1')
    .withMethodFields(PaymentMethod.WALLET, 'PAYCELL_WALLET', { gsmNumber: '+905321234567' })
    .toJSON();

  assert.equal(body.amount, 12500);
  assert.equal(body.price, undefined);
  assert.equal(body.paidPrice, undefined);
  assert.deepEqual(body.wallet, { providerCode: 'PAYCELL_WALLET', gsmNumber: '+905321234567' });
  assert.equal(body.mobileBilling, undefined);
});

test('an empty block is sent as an object (value prefilled from buyer)', () => {
  const body = new DirectMethodPaymentRequest(5000, 'TRY', 'ORD-MB-2')
    .withMethodFields(PaymentMethod.MOBILE_BILLING, null)
    .withBuyer(new Buyer({ gsmNumber: '+905321234567' }))
    .toJSON();

  assert.deepEqual(body.mobileBilling, {});
  assert.equal(body.buyer.gsmNumber, '+905321234567');
});

test('withPreauth writes the typed preauth field and nothing into metadata', () => {
  const body = mobileBillingRequest().withMetadata({ crm: 'A-1' }).withPreauth(true).toJSON();

  assert.equal(body.preauth, true);
  assert.deepEqual(body.metadata, { crm: 'A-1' });
  assert.equal(mobileBillingRequest().withPreauth(false).toJSON().preauth, false);
  assert.equal(Object.prototype.hasOwnProperty.call(mobileBillingRequest().toJSON(), 'preauth'), false);
  for (const value of ['true', 1, null, undefined]) {
    assert.throws(() => mobileBillingRequest().withPreauth(value), ConfigurationError);
  }
});

test('withCard pays by card with the CardDetails fields', () => {
  const body = new DirectMethodPaymentRequest(15000, 'TRY', 'ORD-C-1')
    .withCard(card())
    .withForce3D(true)
    .withInstallment(3, 'iq_1')
    .toJSON();

  assert.equal(body.paymentMethod, 'CARD');
  assert.equal(body.card.cardNumber, '5400000000000004');
  assert.equal(body.force3D, true);
  assert.equal(body.installment, 3);
  assert.equal(body.installmentQuoteToken, 'iq_1');
});

test('card is chosen with withCard, not withMethodFields', () => {
  assert.throws(
    () => new DirectMethodPaymentRequest(5000, 'TRY', 'O').withMethodFields(PaymentMethod.CARD, null, {}),
    /withCard/,
  );
  assert.throws(() => new DirectMethodPaymentRequest(5000, 'TRY', 'O').withCard({}), ConfigurationError);
});

test('card-only fields are refused with another method', () => {
  for (const apply of [
    (r) => r.withForce3D(true),
    (r) => r.withInstallment(2),
  ]) {
    const request = apply(mobileBillingRequest());
    assert.throws(() => request.toJSON(), /only be sent with a card payment/);
  }
});

test('a request without a method cannot be serialized', () => {
  assert.throws(() => new DirectMethodPaymentRequest(5000, 'TRY', 'O').toJSON(), /withMethodFields|withCard/);
});

test('a method the gateway has no block for yet is refused before sending', () => {
  for (const method of [PaymentMethod.BNPL, PaymentMethod.QR_CODE, 'QR', PaymentMethod.BANK_TRANSFER]) {
    assert.throws(
      () => new DirectMethodPaymentRequest(5000, 'TRY', 'O').withMethodFields(method, null, {}),
      /cannot be paid through direct\/payment yet/,
    );
  }
});

test('method fields are checked for the structure the gateway accepts', () => {
  const request = () => new DirectMethodPaymentRequest(5000, 'TRY', 'O');
  const bad = [
    { providerCode: 'X' },
    { 'gsm-number': '+90' },
    { __proto__: { polluted: true }, gsmNumber: '+90' },
    { address: { line: { deep: true } } },
    { address: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${i}`, 'v'])) },
    { guarantors: Array.from({ length: 11 }, () => ({ name: 'a' })) },
    { guarantors: ['a'] },
    { guarantors: [{ address: [{ nested: true }] }] },
    { guarantors: [{ 'tc-no': '1' }] },
    { gsmNumber: 'x'.repeat(1025) },
    { amount: Number.NaN },
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, 'v'])),
    ['gsmNumber'],
    'gsmNumber',
  ];
  for (const fields of bad) {
    assert.throws(() => request().withMethodFields(PaymentMethod.MOBILE_BILLING, null, fields), ConfigurationError, JSON.stringify(fields));
  }
  for (const providerCode of ['', 'PAYCELL WALLET', 'a'.repeat(65), 7]) {
    assert.throws(() => request().withMethodFields(PaymentMethod.WALLET, providerCode, {}), ConfigurationError);
  }
  assert.doesNotThrow(() => request().withMethodFields(PaymentMethod.MOBILE_BILLING, null, { gsmNumber: '+90', consent: true, count: 2 }));
  // ADDRESS (object of scalars) and GROUP (list of objects) values, as the gateway accepts them.
  assert.doesNotThrow(() => request().withMethodFields(PaymentMethod.MOBILE_BILLING, null, {
    address: { provinceCode: '06', districtCode: '100', neighborhoodCode: '200', line: 'Ornek Sokak 1' },
    guarantors: [{ name: 'Test', address: { provinceCode: '34' } }],
  }));
});

test('amounts are positive integers in minor units', () => {
  for (const amount of [0, -1, 50.5, '5000', null]) {
    assert.throws(() => new DirectMethodPaymentRequest(amount, 'TRY', 'O'), ConfigurationError);
  }
  assert.throws(() => new DirectMethodPaymentRequest(5000, 'TRY', ''), ConfigurationError);
});

test('every key the builder can emit is a DirectMethodPaymentDto field', () => {
  const full = new DirectMethodPaymentRequest(15000, 'TRY', 'ORD-ALL')
    .withCard(card())
    .withInstallment(2, 'iq')
    .withForce3D(true)
    .withPreauth(true)
    .withCallbackUrl('https://merchant.example.com/cb')
    .withLocale('tr')
    .withDescription('d')
    .withCustomerId('c')
    .withPaymentChannel('WEB')
    .withPaymentGroup('PRODUCT')
    .withBuyer(new Buyer({ name: 'Ada' }))
    .withBillingAddress(new Address({ city: 'Istanbul' }))
    .withShippingAddress(new Address({ city: 'Istanbul' }))
    .withBasketItems([new BasketItem({ id: 'i1', price: 15000 })])
    .withMetadata({ k: 'v' })
    .toJSON();
  const wallet = new DirectMethodPaymentRequest(1, 'TRY', 'O').withMethodFields(PaymentMethod.WALLET, 'P', {}).toJSON();

  for (const key of [...Object.keys(full), ...Object.keys(wallet), ...Object.keys(mobileBillingRequest().toJSON())]) {
    assert.ok(DIRECT_METHOD_PAYMENT_FIELDS.includes(key), key);
  }
});

// --- payments.directMethodPayment ---------------------------------------------------

test('directMethodPayment posts to /direct/payment, signed and keyed', async () => {
  const { client, calls } = makeClient(() => otpAnswer());

  const response = await client.payments.directMethodPayment(mobileBillingRequest(), 'pay:ORD-MB-1');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/direct/payment');
  assert.equal(call.headers['Idempotency-Key'], 'pay:ORD-MB-1');
  assert.equal(call.headers.Authorization, 'Bearer bearer_x');
  assert.ok(call.headers['X-Signature']);
  assert.ok(call.headers.Digest);
  assert.deepEqual(JSON.parse(call.body), mobileBillingRequest().toJSON());
  assert.equal(response.data.action.type, PaymentActionType.OTP);
  assert.equal(response.data.action.id, 'act_1');
});

test('directMethodPayment refuses to send without an Idempotency-Key', async () => {
  const { client, calls } = makeClient();

  for (const key of [null, undefined, '', '   ']) {
    await assert.rejects(() => client.payments.directMethodPayment(mobileBillingRequest(), key), ConfigurationError);
  }
  assert.equal(calls.length, 0);
});

test('a raw body is checked against the DTO before sending', async () => {
  const { client, calls } = makeClient();
  const base = { paymentMethod: 'MOBILE_BILLING', amount: 5000, currency: 'TRY', orderId: 'O', mobileBilling: {} };

  const bad = [
    { ...base, autoCapture: false },
    { ...base, method: 'MOBILE_BILLING' },
    { ...base, wallet: { providerCode: 'P' } },
    { ...base, mobileBilling: undefined },
    { ...base, force3D: true },
    { ...base, card: { cardNumber: '4111' } },
    { ...base, preauth: 'false' },
    { ...base, amount: undefined },
    { ...base, price: 5000 },
    { ...base, paidPrice: 5000 },
    { ...base, paidPrice: null },
    { ...base, paymentMethod: 'mobile billing' },
    { ...base, paymentMethod: 'CARD', mobileBilling: undefined },
    { ...base, paymentMethod: 'CARD', mobileBilling: undefined, card: { cardNumber: '4111' }, force3D: 'true' },
  ];
  for (const body of bad) {
    await assert.rejects(() => client.payments.directMethodPayment(body, 'k-1'), ConfigurationError, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);

  await client.payments.directMethodPayment(base, 'k-2');
  assert.equal(calls.length, 1);
});

test('a declined payment throws ValidationError carrying the payment fields', async () => {
  const { client } = makeClient(() => [400, {
    status: 'failure',
    code: 'payment.declined',
    message: 'Payment declined',
    statusCode: 400,
    data: { paymentId: PAYMENT_ID, orderId: 'ORD-MB-1', status: 'FAILED', paymentMethod: 'MOBILE_BILLING' },
  }]);

  await assert.rejects(
    () => client.payments.directMethodPayment(mobileBillingRequest(), 'k-decl'),
    (error) => error instanceof ValidationError
      && error.code === 'payment.declined'
      && error.response.data.paymentId === PAYMENT_ID
      && error.response.data.status === 'FAILED',
  );
});

test('a declined direct payment is not retried', async () => {
  const { client, calls } = makeClient(() => [400, { status: 'failure', code: 'payment.declined', data: {} }]);

  await assert.rejects(() => client.payments.directMethodPayment(mobileBillingRequest(), 'k-once'), ValidationError);
  assert.equal(calls.length, 1);
});

// --- Action endpoint ---------------------------------------------------------------

test('confirmPaymentAction posts only the code, signed, to the action path', async () => {
  const { client, calls } = makeClient(() => [200, {
    status: 'success',
    code: 'SUCCESS',
    data: { paymentId: PAYMENT_ID, orderId: 'ORD-MB-1', status: 'CAPTURED', paymentMethod: 'MOBILE_BILLING' },
  }]);

  const response = await client.payments.confirmPaymentAction(PAYMENT_ID, 'act_1', { otp: '123456' });

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `https://gw.example.com/api/v1/payments/${PAYMENT_ID}/actions/act_1/confirm`);
  assert.deepEqual(JSON.parse(call.body), { otp: '123456' });
  assert.ok(call.headers['X-Signature']);
  assert.ok(call.headers.Digest);
  assert.equal(call.headers['Idempotency-Key'], undefined);
  assert.equal(response.data.status, 'CAPTURED');
});

test('confirm carries consent and INPUT fields; ids are path-encoded', async () => {
  const { client, calls } = makeClient();

  await client.payments.confirmPaymentAction('p/1', 'act 2', {
    consentAccepted: true,
    fields: { identityNumber: '10000000146', birthDate: '1990-01-31' },
  });

  const call = calls.at(-1);
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/p%2F1/actions/act%202/confirm');
  assert.deepEqual(JSON.parse(call.body), {
    consentAccepted: true,
    fields: { identityNumber: '10000000146', birthDate: '1990-01-31' },
  });
});

test('confirm never sends the checkout token fields and refuses an empty or malformed input', async () => {
  const { client, calls } = makeClient();
  const bad = [
    {},
    { token: 'ct_1', otp: '123456' },
    { checkoutSessionProof: 'proof', otp: '123456' },
    { otp: 123456 },
    { otp: '12 34' },
    { otp: '' },
    { consentAccepted: 'true' },
    { fields: { providerCode: 'X' } },
    // K16: a flat object (ADDRESS) is valid; an object inside it is not.
    { fields: { nested: { a: { b: 1 } } } },
    { fields: { list: [{ inner: [{ a: 1 }] }] } },
    null,
    'otp',
  ];
  for (const input of bad) {
    await assert.rejects(() => client.payments.confirmPaymentAction(PAYMENT_ID, 'act_1', input), ConfigurationError, JSON.stringify(input));
  }
  for (const [paymentId, actionId] of [['', 'act_1'], [PAYMENT_ID, ''], [null, 'act_1'], [PAYMENT_ID, undefined]]) {
    await assert.rejects(() => client.payments.confirmPaymentAction(paymentId, actionId, { otp: '1' }), ConfigurationError);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual([...PAYMENT_ACTION_CONFIRM_FIELDS], ['otp', 'consentAccepted', 'fields']);
});

test('a rejected code is a 422 ApiError with the remaining attempts; it is not retried', async () => {
  const { client, calls } = makeClient(() => [422, {
    status: 'failure',
    code: 'payment.action.input_rejected',
    message: 'Code rejected',
    statusCode: 422,
    details: { attemptsRemaining: 2 },
    data: null,
  }]);

  await assert.rejects(
    () => client.payments.confirmPaymentAction(PAYMENT_ID, 'act_1', { otp: '000000' }),
    (error) => error instanceof ApiError
      && !(error instanceof ValidationError)
      && error.statusCode === 422
      && error.code === 'payment.action.input_rejected'
      && error.response.details.attemptsRemaining === 2,
  );
  assert.equal(calls.length, 1);
});

test('resendPaymentAction posts a bodiless signed request and returns the new action', async () => {
  const { client, calls } = makeClient(() => otpAnswer('act_2'));

  const response = await client.payments.resendPaymentAction(PAYMENT_ID, 'act_1');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `https://gw.example.com/api/v1/payments/${PAYMENT_ID}/actions/act_1/resend`);
  assert.equal(call.body, null);
  assert.ok(call.headers['X-Signature']);
  assert.equal(call.headers.Digest, undefined);
  assert.equal(response.data.action.id, 'act_2');
});

test('OTP flow: start, resend, confirm with the new action id', async () => {
  const answers = [otpAnswer('act_1'), otpAnswer('act_2'), [200, { status: 'success', data: { paymentId: PAYMENT_ID, status: 'CAPTURED' } }]];
  const { client, calls } = makeClient(() => answers.shift());

  const started = await client.payments.directMethodPayment(mobileBillingRequest(), 'pay:ORD-MB-1');
  const resent = await client.payments.resendPaymentAction(started.data.paymentId, started.data.action.id);
  const done = await client.payments.confirmPaymentAction(resent.data.paymentId, resent.data.action.id, { otp: '123456' });

  assert.deepEqual(calls.map((call) => call.url.replace('https://gw.example.com/api/v1/payments', '')), [
    '/direct/payment',
    `/${PAYMENT_ID}/actions/act_1/resend`,
    `/${PAYMENT_ID}/actions/act_2/confirm`,
  ]);
  assert.equal(done.data.status, 'CAPTURED');
});

// --- payments.listPaymentMethods ----------------------------------------------------

test('listPaymentMethods is a signed GET /payments/methods', async () => {
  const methods = [{
    paymentMethod: 'MOBILE_BILLING',
    category: 'TELCO',
    blockName: 'mobileBilling',
    displayName: 'Faturana Yansıt',
    providerSelection: 'OPTIONAL',
    actionTypes: ['OTP'],
    currencies: ['TRY'],
    minAmount: 100,
    maxAmount: 50000,
    preauth: false,
    providers: [{
      providerCode: 'PAYCELL_MOBILE_BILLING',
      displayName: 'Paycell Faturana Yansıt',
      logoUrl: null,
      actionTypes: ['OTP'],
      currencies: ['TRY'],
      minAmount: 100,
      maxAmount: 50000,
      preauth: false,
      inputFields: [{
        key: 'gsmNumber', type: 'PHONE', required: true, label: { tr: 'Hat', en: 'Line' },
        prefill: 'buyer.gsmNumber', pii: true, pattern: null, minLength: null, maxLength: null, options: [], url: null,
      }],
    }],
  }];
  const { client, calls } = makeClient(() => [200, { status: 'success', code: 'SUCCESS', data: { methods } }]);

  const response = await client.payments.listPaymentMethods();

  const call = calls.at(-1);
  assert.equal(call.method, 'GET');
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/methods');
  assert.ok(call.headers['X-Signature'], 'the methods route is behind the API-key signature');
  assert.equal(call.body, null);
  const [method] = response.data.methods;
  assert.equal(method.blockName, 'mobileBilling');
  assert.equal(method.providers[0].inputFields[0].key, 'gsmNumber');
});

test('listPaymentMethods({ paymentMethod }) signs the query and lists one method', async () => {
  const { client, calls } = makeClient(() => [200, { status: 'success', code: 'SUCCESS', data: { methods: [] } }]);

  await client.payments.listPaymentMethods({ paymentMethod: PaymentMethod.MOBILE_BILLING });
  await client.payments.listPaymentMethods({ paymentMethod: 'QR' });
  await client.payments.listPaymentMethods({});
  await client.payments.listPaymentMethods({ paymentMethod: undefined });

  assert.deepEqual(calls.map((call) => call.url), [
    'https://gw.example.com/api/v1/payments/methods?paymentMethod=MOBILE_BILLING',
    'https://gw.example.com/api/v1/payments/methods?paymentMethod=QR_CODE',
    'https://gw.example.com/api/v1/payments/methods',
    'https://gw.example.com/api/v1/payments/methods',
  ]);
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.ok(call.headers['X-Signature'], 'the query is part of the signed request');
  }
});

test('listPaymentMethods refuses a malformed paymentMethod or an unknown option before sending', async () => {
  const { client, calls } = makeClient();

  for (const options of [
    { paymentMethod: 'mobile_billing' },
    { paymentMethod: '' },
    { paymentMethod: 42 },
    { method: 'MOBILE_BILLING' },
    'MOBILE_BILLING',
    ['MOBILE_BILLING'],
  ]) {
    await assert.rejects(client.payments.listPaymentMethods(options), ConfigurationError, JSON.stringify(options));
  }
  assert.equal(calls.length, 0);
});

test('an unknown method code from the gateway is a ValidationError with payment.method.unknown', async () => {
  const { client } = makeClient(() => [400, {
    status: 'failure',
    code: 'payment.method.unknown',
    message: 'Ödeme yöntemi tanınmıyor',
    statusCode: 400,
    details: { field: 'paymentMethod', allowed: ['CARD', 'MOBILE_BILLING'] },
  }]);

  await assert.rejects(client.payments.listPaymentMethods({ paymentMethod: 'APPLE_PAY' }), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.code, 'payment.method.unknown');
    return true;
  });
});

test('ProviderSelectionMode carries BUYER and PLATFORM, and ProviderSelection is unchanged', () => {
  assert.deepEqual({ ...ProviderSelectionMode }, { BUYER: 'BUYER', PLATFORM: 'PLATFORM' });
  assert.ok(Object.isFrozen(ProviderSelectionMode));
  assert.deepEqual({ ...ProviderSelection }, { ROUTED: 'ROUTED', OPTIONAL: 'OPTIONAL', REQUIRED: 'REQUIRED' });

  const typings = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  assert.match(typings, /export const ProviderSelectionMode: \{ readonly BUYER: 'BUYER'; readonly PLATFORM: 'PLATFORM' \};/);
  assert.match(typings, /providerSelectionMode: ProviderSelectionModeValue;/);
  assert.match(typings, /listPaymentMethods\(options\?: ListPaymentMethodsOptions\)/);
});

test('a PLATFORM method is paid without providerCode; a BUYER method with the chosen one', () => {
  const platform = new DirectMethodPaymentRequest(5000, 'TRY', 'ORD-P-1')
    .withMethodFields(PaymentMethod.MOBILE_BILLING, null, { gsmNumber: '+905321234567' })
    .toJSON();
  const buyer = new DirectMethodPaymentRequest(5000, 'TRY', 'ORD-B-1')
    .withMethodFields(PaymentMethod.WALLET, 'WALLET_BRAND_B', {})
    .toJSON();

  assert.deepEqual(platform.mobileBilling, { gsmNumber: '+905321234567' });
  assert.equal(Object.prototype.hasOwnProperty.call(platform.mobileBilling, 'providerCode'), false);
  assert.equal(buyer.wallet.providerCode, 'WALLET_BRAND_B');
});

test('payment.provider.none_eligible reaches the caller as an ApiError with the candidates', async () => {
  const candidates = [
    { providerCode: 'MB_PROVIDER_A', outcome: 'INELIGIBLE', reason: 'AMOUNT_OUT_OF_RANGE' },
    { providerCode: 'MB_PROVIDER_B', outcome: 'UNAVAILABLE', reason: 'ELIGIBILITY_TIMEOUT' },
  ];
  const { client } = makeClient(() => [422, {
    status: 'failure',
    code: 'payment.provider.none_eligible',
    message: 'None of the connected providers can take this payment; the payment was not started and nothing was charged.',
    statusCode: 422,
    docsUrl: 'https://docs.lunixi.com/getting-started/errors#payment.provider.none_eligible',
    details: { paymentMethod: 'MOBILE_BILLING', candidates },
  }]);

  await assert.rejects(client.payments.directMethodPayment(mobileBillingRequest(), 'k-none-eligible'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error instanceof ValidationError, false);
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'payment.provider.none_eligible');
    assert.deepEqual(error.response.details.candidates, candidates);
    return true;
  });
});

test('the listed inputFields build the method block', () => {
  const provider = { providerCode: 'PAYCELL_MOBILE_BILLING', inputFields: [{ key: 'gsmNumber', type: 'PHONE' }] };
  const fields = Object.fromEntries(provider.inputFields.map((field) => [field.key, '+905321234567']));

  const body = new DirectMethodPaymentRequest(5000, 'TRY', 'ORD-L-1')
    .withMethodFields('MOBILE_BILLING', provider.providerCode, fields)
    .toJSON();

  assert.deepEqual(body.mobileBilling, { providerCode: 'PAYCELL_MOBILE_BILLING', gsmNumber: '+905321234567' });
});

// --- Card: direct/payment is the only server-side card charge ------------------------

test('the direct 2D/3D card methods and DirectPaymentRequest are removed', () => {
  const { client } = makeClient();
  const sdk = require('../src');
  const typings = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');

  for (const method of ['chargeCard', 'chargeCard2d', 'chargeCard3d']) {
    assert.equal(client.payments[method], undefined, `payments.${method}`);
    assert.doesNotMatch(typings, new RegExp(`\\b${method}\\(`), `index.d.ts declares ${method}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(sdk, 'DirectPaymentRequest'), false);
  assert.doesNotMatch(typings, /\bDirectPaymentRequest\b/);
  assert.doesNotMatch(typings, /direct\/(2d|3d)/);
});

test('a card goes to direct/payment as paymentMethod CARD, with force3D only when asked', async () => {
  const { client, calls } = makeClient();
  const base = () => new DirectMethodPaymentRequest(10050, 'TRY', 'ORD-D-1')
    .withCard(card())
    .withBuyer(new Buyer({ name: 'Ada' }))
    .withBillingAddress(new Address({ city: 'Istanbul' }))
    .withBasketItems([new BasketItem({ id: 'i1', price: 10050 })]);

  await client.payments.directMethodPayment(base(), 'k-card');
  await client.payments.directMethodPayment(base().withForce3D(true), 'k-card-3d');

  assert.deepEqual(calls.map((call) => call.url), [
    'https://gw.example.com/api/v1/payments/direct/payment',
    'https://gw.example.com/api/v1/payments/direct/payment',
  ]);
  const [plain, secure] = calls.map((call) => JSON.parse(call.body));
  for (const body of [plain, secure]) {
    assert.equal(body.paymentMethod, 'CARD');
    assert.equal(body.card.cardNumber, '5400000000000004');
    assert.equal(body.amount, 10050);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'force3D'), false);
  assert.equal(secure.force3D, true);
});

test('a stored card is charged through direct/payment with cardUserKey + cardToken', async () => {
  const { client, calls } = makeClient();
  const request = new DirectMethodPaymentRequest(10050, 'TRY', 'ORD-S-1')
    .withCard(new CardDetails({ cardUserKey: 'cust_1', cardToken: 'ct_1', cvcNumber: '123' }));

  await client.payments.directMethodPayment(request, 'k-stored');

  const body = JSON.parse(calls[0].body);
  assert.equal(new URL(calls[0].url).pathname, '/api/v1/payments/direct/payment');
  assert.deepEqual(body.card, { cardUserKey: 'cust_1', cardToken: 'ct_1', cvcNumber: '123' });
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}
