'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CreateIntentRequest, SplitPaymentRequest, decimalToMinor } = require('../src');
const { minor, validateMoneyFields } = require('../src/money');
const { ApiClient } = require('../src/api-client');
const LARGE = '9007199254740993';
test('canonical fiat strings preserve large amounts and signed balances', () => {
  assert.equal(new CreateIntentRequest(LARGE, 'TRY', 'order').toJSON().amount, LARGE);
  assert.equal(minor('-9007199254740993', 'balance', { signed: true }), '-9007199254740993');
  for (const value of [1, 9007199254740992, '0', '-0', '01', '+1', ' 1', '1\n', '1.0', '1e3', 'NaN', 'Infinity', '9223372036854775808']) assert.throws(() => minor(value));
  assert.doesNotThrow(() => validateMoneyFields({ amount: LARGE, metadata: { amount: 1 }, providerPayload: { amount: 1 }, rate: 1.5, count: 2 }));
  assert.throws(() => validateMoneyFields({ data: { amount: 1 } }, { response: true }));
});
test('decimal text uses actual JPY TRY KWD precision', () => {
  assert.equal(decimalToMinor('9007199254740993', 'JPY'), LARGE);
  assert.equal(decimalToMinor('90071992547409.93', 'TRY'), LARGE);
  assert.equal(decimalToMinor('9007199254740.993', 'KWD'), LARGE);
  assert.throws(() => decimalToMinor('1.1', 'JPY'));
  assert.throws(() => decimalToMinor('1.001', 'TRY'));
  assert.throws(() => decimalToMinor('1', 'ZZZ'));
  assert.throws(() => decimalToMinor(1, 'TRY'));
});
test('split addition remains exact above JavaScript safe integers', () => {
  const request = new SplitPaymentRequest(LARGE, 'TRY', 'owner').addCardLeg('card-1', '9007199254740992').addCardLeg('card-2', '1');
  assert.equal(request.toJSON().totalAmount, LARGE);
});
test('advanced request and response boundaries reject numeric money and preserve wire strings', async () => {
  const sent = [];
  let amount = LARGE;
  const api = new ApiClient({ baseUrl: 'https://gateway.invalid', maxRetries: 0, timeoutMs: 1000, fetch: async (_, options) => { sent.push(options.body ? JSON.parse(options.body) : null); return { ok: true, text: async () => JSON.stringify({ data: { amount } }) }; } }, {}, { getToken: async () => 'token' });
  assert.equal((await api.request('POST', '/api/v1/payments/intents', { amount: LARGE, metadata: { amount: 1 }, providerPayload: { amount: 1 }, rate: 1.5 })).data.amount, LARGE);
  assert.equal(sent[0].amount, LARGE);
  await assert.rejects(api.request('POST', '/api/v1/payments/intents', { amount: 1 }));
  amount = 1;
  await assert.rejects(api.request('GET', '/api/v1/payments/p1'));
});
test('capture and refund preserve omission and reject explicit null or zero', async () => {
  const { PaymentClient } = require('../src/payment/payment-client');
  const bodies = [];
  const client = new PaymentClient({ request: async (_method, _path, body) => { bodies.push(body); return {}; } });
  await client.capture('p', undefined, 'stable-operation-key');
  await client.refund('p', undefined, null, 'stable-operation-key');
  assert.deepEqual(bodies, [{ paymentIntentId: 'p' }, { paymentIntentId: 'p' }]);
  await assert.rejects(client.capture('p', null, 'stable-operation-key'));
  await assert.rejects(client.refund('p', null, null, 'stable-operation-key'));
  await assert.rejects(client.capture('p', '0', 'stable-operation-key'));
  await assert.rejects(client.refund('p', '0', null, 'stable-operation-key'));
  assert.equal(bodies.length, 2);
});
test('pending split protocol responses reject numeric money', async () => {
  const { PaymentClient } = require('../src/payment/payment-client');
  const { ValidationError } = require('../src/errors');
  let amount = 1;
  const client = new PaymentClient({ request: async () => { throw new ValidationError('pending', { statusCode: 400, response: { code: 'AWAITING_ACTION', data: { splitPaymentId: 'split-1', totalAmount: amount } } }); } });
  const request = new SplitPaymentRequest('1', 'TRY', 'owner').addCardLeg('card-1', '1');
  await assert.rejects(client.createSplitPayment(request, 'stable-operation-key'));
  amount = '1';
  assert.equal((await client.createSplitPayment(request, 'stable-operation-key')).data.totalAmount, '1');
});

test('raw capture and refund JSON reject explicit null before authentication or transport', async () => {
  let calls = 0;
  const api = new ApiClient({ baseUrl: 'https://gateway.invalid', maxRetries: 0, timeoutMs: 1000, fetch: async () => { calls++; throw new Error('unexpected network'); } }, {}, { getToken: async () => { calls++; throw new Error('unexpected auth'); } });
  for (const operation of ['capture', 'refund']) await assert.rejects(api.request('POST', `/api/v1/payments/p/${operation}`, { amount: null }, { idempotencyKey: 'stable-operation-key' }));
  assert.equal(calls, 0);
});
