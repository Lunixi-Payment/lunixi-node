'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const vm = require('node:vm');
const { CheckoutForm, validatePaymentPageUrl, ConfigurationError } = require('../src');
const { PaymentClient } = require('../src/payment/payment-client');
const { createNativeCheckout } = require('../samples/_common/native-checkout');

const intent = () => ({ paymentId: 'pi-1', token: 'merchant-only-token',
  paymentPageUrl: 'https://pay.lunixi.com/payment/hosted-separate-origin-token' });

test('actual create response keeps both capabilities, with hosted URL exact and no token fallback', async () => {
  const response = { success: true, data: intent() };
  const payments = new PaymentClient({ request: async () => response });
  assert.equal(await payments.createIntent({ amount: 1990 }, 'persisted-stable-key'), response);
  assert.equal(await payments.createMarketplaceIntent({ amount: 1990 }, 'persisted-stable-key'), response);
  const form = new CheckoutForm(response);
  assert.equal(form.token, response.data.token);
  assert.equal(form.hostedUrl(), response.data.paymentPageUrl);
  assert.ok(!form.hostedUrl().includes(form.token));
  for (const output of [inspect(form), String(form), JSON.stringify(form)]) {
    assert.ok(!output.includes(form.token)); assert.ok(!output.includes('hosted-separate-origin'));
  }
  const legacy = new CheckoutForm({ paymentId: 'pi-1', token: 'old-merchant-token' });
  assert.equal(legacy.embeddedPage().status, 200);
  assert.throws(() => legacy.hostedUrl(), ConfigurationError);
});

test('rejects malformed capabilities, conflicting IDs and attacker redirect targets', () => {
  for (const value of [undefined, {}, { token: 't' }, { ...intent(), id: 'another-payment' }, { ...intent(), success: false }]) {
    assert.throws(() => new CheckoutForm(value), ConfigurationError);
  }
  for (const url of ['http://pay.lunixi.com/payment/t', 'https://pay.lunixi.com.evil.example/payment/t',
    'https://pay.lunixi.com@evil.example/payment/t', 'https://user@pay.lunixi.com/payment/t',
    'https://pay.lunixi.com:444/payment/t', 'https://pay.lunixi.com/payment/t?next=evil',
    'https://pay.lunixi.com/payment/t#fragment', 'https://pay.lunixi.com/payment/a/b',
    'https://pay.lunixi.com/payment/%2e%2e', 'https://pay.lunixi.com/payment/%xx',
    'https://pay.lunixi.com/payment/0123456789abcdef%2Fmore', 'https://pay.lunixi.com/payment/0123456789abcdef%0A',
    'https://pay.lunixi.com/payment/0123456789abcdef\n', 'https://pay.lunixi.com/payment/' + 't'.repeat(4097), '', 123]) {
    assert.throws(() => validatePaymentPageUrl(url), ConfigurationError);
  }
});

test('embedded default safely mounts the real object/token SDK contract under nonce CSP', async () => {
  const malicious = '\"/><script>throw new Error("injected")</script>';
  const form = new CheckoutForm({ ...intent(), token: malicious });
  const page = form.embeddedPage('tr');
  assert.equal(page.status, 200); assert.equal(page.headers['Cache-Control'], 'no-store');
  assert.equal(page.headers['Referrer-Policy'], 'no-referrer');
  assert.ok(!page.body.includes(malicious)); assert.ok(!page.body.includes(intent().paymentPageUrl));
  assert.ok(page.body.includes('https://cdn.lunixi.com/lunixi-checkout.min.js'));
  const nonce = page.body.match(/nonce="([^"]+)"/)[1];
  assert.ok(page.headers['Content-Security-Policy'].includes(`'nonce-${nonce}'`));
  assert.notEqual(page.headers['Content-Security-Policy'], form.embeddedPage().headers['Content-Security-Policy']);
  let callback; let config; let selector;
  const context = { window: { addEventListener: (event, fn) => { assert.equal(event, 'DOMContentLoaded'); callback = fn; },
    Lunixi: { checkout: { create: async (value) => { config = value; return { mount: (value) => { selector = value; } }; } } } },
  document: { getElementById: (id) => { assert.equal(id, 'lunixi-checkout-form'); return { dataset: { token: malicious } }; } } };
  const source = page.body.match(/<script nonce="[^"]+" defer>([\s\S]+)<\/script>/)[1];
  vm.runInNewContext(source, context);
  await callback();
  assert.deepEqual(JSON.parse(JSON.stringify(config)), { type: 'payment', target: 'lunixi-checkout-form', options: { token: malicious } });
  assert.equal(selector, '#lunixi-checkout-form');
});

function adapter() {
  const calls = [];
  const attempt = { request: { amount: 1990, currency: 'TRY', orderId: 'server-order',
    callbackUrl: 'https://shop.example/return', metadata: { allowedOrigin: 'https://shop.example' } },
  key: 'persisted-server-attempt-key', createdAtSeconds: 1000, state: 'reserved' };
  const native = {
    authenticate: async () => { calls.push('auth'); return { id: 'owner-1' }; },
    verifyCsrf: async () => { calls.push('csrf'); return true; },
    reserveCheckout: async (principal, orderId) => { calls.push('reserve'); assert.equal(principal.id, 'owner-1'); assert.equal(orderId, 'owned-order'); return attempt; },
    bindCheckoutResponse: async (bound, response) => { calls.push('bind'); assert.equal(bound, attempt); attempt.response = response; },
    markCheckoutUncertain: async () => { calls.push('review'); attempt.state = 'review'; },
  };
  const client = { payments: { createIntent: async (body, key) => { calls.push('create'); assert.equal(body, attempt.request); assert.equal(key, attempt.key); return { data: intent() }; } } };
  return { native, client, calls, attempt, checkout: () => createNativeCheckout(client, native, () => 1100) };
}

test('native auth/CSRF/reservation precede financial I/O, server totals win, repeated default embeds reuse one attempt', async () => {
  const fixture = adapter();
  const checkout = fixture.checkout();
  const page = await checkout({ body: { amount: 1, card: 'untrusted', mode: 'redirect' } }, 'owned-order');
  assert.equal(page.status, 200);
  assert.deepEqual(fixture.calls, ['auth', 'csrf', 'reserve', 'create', 'bind']);
  assert.equal((await checkout({}, 'owned-order')).status, 200);
  assert.equal(fixture.calls.filter((value) => value === 'create').length, 1);
  assert.equal(fixture.attempt.request.amount, 1990);
});

test('missing native adapter, unauthenticated owner and failed CSRF fail before reservation or financial I/O', async () => {
  assert.throws(() => createNativeCheckout({}, {}), ConfigurationError);
  const fixture = adapter();
  fixture.native.authenticate = async () => null;
  await assert.rejects(fixture.checkout()({}, 'owned-order'), (error) => error.statusCode === 401);
  assert.deepEqual(fixture.calls, []);
  fixture.native.authenticate = async () => ({ id: 'owner-1' });
  fixture.native.verifyCsrf = async () => false;
  await assert.rejects(fixture.checkout()({}, 'owned-order'), (error) => error.statusCode === 403);
  assert.deepEqual(fixture.calls, []);
});

test('optional redirect uses only the backend URL and legacy missing URL never rotates its payment', async () => {
  const fixture = adapter(); fixture.attempt.mode = 'redirect';
  const page = await fixture.checkout()({}, 'owned-order');
  assert.equal(page.status, 303); assert.equal(page.headers.Location, intent().paymentPageUrl);
  delete fixture.attempt.response.data.paymentPageUrl;
  await assert.rejects(fixture.checkout()({}, 'owned-order'), ConfigurationError);
  assert.equal(fixture.calls.filter((value) => value === 'create').length, 1);
  assert.equal(fixture.attempt.key, 'persisted-server-attempt-key');
});

test('uncertain creates hold the native attempt; no new key, hidden error or blind retry can charge again', async () => {
  const fixture = adapter();
  fixture.client.payments.createIntent = async () => { fixture.calls.push('create'); throw new Error('sensitive upstream details'); };
  await assert.rejects(fixture.checkout()({}, 'owned-order'), (error) => error.statusCode === 409 && !error.message.includes('sensitive'));
  await assert.rejects(fixture.checkout()({}, 'owned-order'), (error) => error.statusCode === 409);
  assert.equal(fixture.calls.filter((value) => value === 'create').length, 1);
  assert.equal(fixture.attempt.key, 'persisted-server-attempt-key'); assert.equal(fixture.attempt.state, 'review');
});

test('expired unconfirmed or cached attempts and raw-card/money request drift stop before financial I/O', async () => {
  for (const change of [
    (attempt) => { attempt.createdAtSeconds = 1100 - 23 * 3600; },
    (attempt) => { attempt.response = { data: intent() }; attempt.createdAtSeconds = 1100 - 840; },
    (attempt) => { attempt.request.amount = 19.90; },
    (attempt) => { attempt.request.card = {}; },
  ]) {
    const fixture = adapter(); change(fixture.attempt);
    await assert.rejects(fixture.checkout()({}, 'owned-order'), (error) => error.statusCode === 409);
    assert.ok(!fixture.calls.includes('create'));
  }
});
