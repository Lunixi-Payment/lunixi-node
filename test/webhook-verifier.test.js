'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const { WebhookVerifier, ConfigurationError } = require('../src');

// Shared cross-SDK vectors (same file ships in the PHP SDK test suite).
const vectors = require(path.join(__dirname, 'fixtures', 'webhook-v2-vectors.json'));
const byName = Object.fromEntries(vectors.map((v) => [v.name, v]));

// Fixed vector timestamps are in the past — disable the freshness check for
// vector tests; the tolerance behaviour has its own tests below.
const NO_TOLERANCE = { toleranceSeconds: null };

function headersFor(v, signatureHeader) {
  return {
    'x-lunixi-event-id': v.eventId,
    'x-lunixi-event-type': 'payment.captured',
    'x-lunixi-signature-timestamp': v.timestamp,
    'x-lunixi-signature': signatureHeader,
  };
}

test('v2: every shared vector verifies against its expected HMAC', () => {
  for (const v of vectors) {
    const event = new WebhookVerifier(v.secret, NO_TOLERANCE)
      .verify(v.rawBody, headersFor(v, `v2=${v.expectedV2}`));
    assert.equal(event.id, JSON.parse(v.rawBody).id, v.name);
  }
});

test('v2: raw body is accepted as a Buffer without parsing', () => {
  const v = byName['unicode-and-slashes'];
  const event = new WebhookVerifier(v.secret, NO_TOLERANCE)
    .verify(Buffer.from(v.rawBody, 'utf8'), headersFor(v, `v2=${v.expectedV2}`));
  assert.equal(event.data.merchantName, 'Şükrü & Oğulları Ltd. Şti.');
  assert.equal(event.data.docsUrl, 'https://docs.lunixi.com/tr/payments');
});

test('v2 rotation: header with both v2 items verifies under EITHER secret', () => {
  const current = byName['basic-payment-captured'];
  const previous = byName['rotated-previous-secret'];
  const rotatedHeader = `v2=${current.expectedV2},v2=${previous.expectedV2}`;

  for (const v of [current, previous]) {
    const event = new WebhookVerifier(v.secret, NO_TOLERANCE)
      .verify(v.rawBody, headersFor(v, rotatedHeader));
    assert.equal(event.type, 'payment.captured');
  }
});

test('rotated-previous-secret: new-secret v2 item alone fails under the previous secret', () => {
  const current = byName['basic-payment-captured'];
  const previous = byName['rotated-previous-secret'];
  assert.throws(
    () => new WebhookVerifier(previous.secret, NO_TOLERANCE)
      .verify(previous.rawBody, headersFor(previous, `v2=${current.expectedV2}`)),
    ConfigurationError,
  );
});

test('header with only a sha256= item is rejected (no v1 scheme exists)', () => {
  const v = byName['basic-payment-captured'];
  assert.throws(
    () => new WebhookVerifier(v.secret, NO_TOLERANCE)
      .verify(v.rawBody, headersFor(v, `sha256=${'0'.repeat(64)}`)),
    ConfigurationError,
  );
});

test('unknown non-v2 items are ignored: wrong v2 rejects even with other items present', () => {
  const v = byName['basic-payment-captured'];
  assert.throws(
    () => new WebhookVerifier(v.secret, NO_TOLERANCE)
      .verify(v.rawBody, headersFor(v, `v2=${'0'.repeat(64)},sha256=${'0'.repeat(64)}`)),
    ConfigurationError,
  );
});

test('v2 is byte-sensitive: any re-serialization of the body breaks the signature', () => {
  const v = byName['basic-payment-captured'];
  const reserialized = JSON.stringify(JSON.parse(v.rawBody), null, 2); // same JSON, different bytes
  assert.throws(
    () => new WebhookVerifier(v.secret, NO_TOLERANCE)
      .verify(reserialized, headersFor(v, `v2=${v.expectedV2}`)),
    ConfigurationError,
  );
});

test('timestamp tolerance still applies to v2 signatures', () => {
  const v = byName['basic-payment-captured'];
  // Vector timestamp (2026-08-19T10:00Z) is stale relative to test wall-clock.
  assert.throws(
    () => new WebhookVerifier(v.secret, { toleranceSeconds: 300 })
      .verify(v.rawBody, headersFor(v, `v2=${v.expectedV2}`)),
    ConfigurationError,
  );
});

test('fresh v2 signature passes with the default tolerance', () => {
  const secret = 'whsec_fresh';
  const rawBody = '{"id":"evt_f","type":"payment.refunded","data":{"amountMinor":"100"}}';
  const timestamp = new Date().toISOString();
  const sig = crypto.createHmac('sha256', secret).update(`evt_f.${timestamp}.${rawBody}`).digest('hex');

  const event = new WebhookVerifier(secret).verify(rawBody, {
    'x-lunixi-event-id': 'evt_f',
    'x-lunixi-signature-timestamp': timestamp,
    'x-lunixi-signature': `v2=${sig}`,
  });
  assert.equal(event.type, 'payment.refunded');
});

test('whitespace around comma-separated items is tolerated', () => {
  const v = byName['basic-payment-captured'];
  const event = new WebhookVerifier(v.secret, NO_TOLERANCE)
    .verify(v.rawBody, headersFor(v, ` v2=${v.expectedV2} , v2=deadbeef `));
  assert.equal(event.type, 'payment.captured');
});
