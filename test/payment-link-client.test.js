'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LunixiClient,
  PaymentLinkClient,
  CreatePaymentLinkRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  PaymentLinkUsage,
  PaymentLinkState,
  CustomFieldType,
  PaymentLinkDeliveryChannel,
  PaymentLinkImageContentType,
  PAYMENT_LINK_SPEC_FIELDS,
  ConfigurationError,
  ApiError,
  ValidationError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const LINK_ID = '3f1c2a9e-5b7d-4c1e-9a2b-6d8e0f1a2b3c';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
// A presigned PUT URL: the storage host, never the gateway. Its query string is the signature.
// `.invalid` (RFC 2606) never resolves, so a request that escaped the fake transport sends nothing.
const STORAGE_URL = `https://storage.invalid/lunixi-media/org_1/general/${ASSET_ID}.png`
  + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=abc123';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

/** Headers that authenticate a gateway request. Not one of them may reach the storage host. */
const GATEWAY_CREDENTIAL_HEADERS = ['authorization', 'x-key-id', 'x-date', 'x-nonce', 'x-signature', 'digest'];

function credentialHeaders(call) {
  return Object.keys(call.headers || {}).filter((name) => GATEWAY_CREDENTIAL_HEADERS.includes(name.toLowerCase()));
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    text: async () => JSON.stringify(body),
  };
}

/** A storage answer: empty on success, an S3-style XML error otherwise. */
function storageResponse(status, text = '') {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => text };
}

function uploadTarget(overrides = {}) {
  return {
    assetId: ASSET_ID,
    uploadUrl: STORAGE_URL,
    uploadMethod: 'PUT',
    uploadHeaders: { 'Content-Type': 'image/png' },
    expiresAt: '2026-09-29T12:15:00.000Z',
    ...overrides,
  };
}

function publishedImage(overrides = {}) {
  return { assetId: ASSET_ID, url: `https://cdn.lunixi.com/assets/${ASSET_ID}`, state: 'PUBLISHED', ...overrides };
}

/** Answers the three steps of an image upload: create (201), the storage PUT, confirm. */
function imageResponder(storage = () => storageResponse(200)) {
  return (call) => {
    if (call.url === STORAGE_URL) return storage(call);
    if (call.url.endsWith('/confirm')) return jsonResponse(200, successEnvelope(publishedImage()));
    return jsonResponse(201, successEnvelope(uploadTarget(), { statusCode: 201 }));
  };
}

function binaryResponse(status, bytes, contentType) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', contentType]]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString('latin1'),
  };
}

/**
 * Verifies a request the way the gateway's SignatureGuard does
 * (nest-payment-gateway apps/api-gateway/src/auth/guards/signature.guard.ts):
 * the Digest is SHA-256 over JSON.stringify of the PARSED body, and the
 * canonical string is METHOD, request target (path + query), X-Date, X-Nonce
 * and Digest when the header is present. The guard ignores `Authorization`.
 */
function signatureGuardVerdict(call, publicKey) {
  const h = call.headers;
  if (!h['X-Key-Id'] || !h['X-Date'] || !h['X-Nonce'] || !h['X-Signature']) return 'AUTH_HEADERS_MISSING';
  if (Math.abs(Date.now() - new Date(h['X-Date']).getTime()) > 300000) return 'INVALID_DATE';
  const body = call.body ? JSON.parse(call.body) : undefined;
  if (body && Object.keys(body).length > 0) {
    if (!h.Digest) return 'DIGEST_MISSING';
    const expected = 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
    if (h.Digest !== expected) return 'INVALID_DIGEST';
  }
  const target = call.url.slice(BASE_URL.length);
  const lines = [call.method.toUpperCase(), target, `X-Date:${h['X-Date']}`, `X-Nonce:${h['X-Nonce']}`];
  if (h.Digest) lines.push(`Digest:${h.Digest}`);
  const ok = crypto.verify(null, Buffer.from(lines.join('\n')), publicKey, Buffer.from(h['X-Signature'], 'base64'));
  return ok ? 'OK' : 'INVALID_SIGNATURE';
}

/**
 * A client over a scripted transport. Token mints are answered here and kept
 * out of `calls`, so `calls` holds only payment-link requests.
 */
function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const publicKey = crypto.createPublicKey(keys.publicKey);
  const calls = [];
  const tokenCalls = [];
  const fetch = async (url, options = {}) => {
    const call = { url: String(url), ...options };
    if (call.url === BASE_URL + TOKEN_PATH) {
      tokenCalls.push(call);
      return jsonResponse(200, { access_token: `at_test_${tokenCalls.length}`, expires_in: 1800 });
    }
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({
    baseUrl: BASE_URL,
    keyId: 'mk_test_sk_kid_1',
    privateKey: keys.privateKey,
    fetch,
    maxRetries: 0,
  });
  return { client, calls, tokenCalls, publicKey };
}

function linkJson(overrides = {}) {
  return {
    id: LINK_ID,
    shortCode: 'K7M2Q9XR4T',
    url: 'https://pay.lunixi.com/K7M2Q9XR4T',
    environment: 'TEST',
    state: 'ACTIVE',
    version: 1,
    rowVersion: 1,
    usage: 'SINGLE_USE',
    amountMode: 'FIXED',
    currency: 'TRY',
    amountMinor: 150000,
    title: 'Kasım danışmanlık bedeli',
    ...overrides,
  };
}

function successEnvelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', data, statusCode: 200, requestId: 'req_1', ...extra };
}

function route(call) {
  return `${call.method} ${call.url.slice(BASE_URL.length).split('?')[0]}`;
}

test('create is signed per request with the API key and verifies like SignatureGuard', async () => {
  const { client, calls, tokenCalls, publicKey } = makeClient(() => jsonResponse(201, successEnvelope({ ...linkJson(), replayed: false })));

  const request = CreatePaymentLinkRequest.fixed(PaymentLinkUsage.SINGLE_USE, 150000, 'try', 'Kasım danışmanlık bedeli')
    .withDescription('Satır sonu ve "tırnak" / eğik çizgi')
    .withExpiresAt(new Date('2026-10-31T20:59:59Z'))
    .withReference('INV-2026-0042')
    .withRecipient({ name: 'Ayşe Yılmaz', email: 'ayse@example.com' })
    .withMetadata({ crmId: 'A-77', 10: 'numeric-key' });

  const link = await client.paymentLinks.create(request, 'plink-create-INV-2026-0042');

  assert.equal(link.id, LINK_ID);
  assert.equal(link.replayed, false);
  assert.equal(calls.length, 1);
  assert.equal(tokenCalls.length, 1);

  const call = calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE_URL}/api/v1/payments/links`);
  assert.equal(call.headers['Idempotency-Key'], 'plink-create-INV-2026-0042');
  assert.equal(call.headers['X-Key-Id'], 'mk_test_sk_kid_1');
  assert.equal(signatureGuardVerdict(call, publicKey), 'OK');

  const body = JSON.parse(call.body);
  assert.equal(body.usage, 'SINGLE_USE');
  assert.equal(body.amountMode, 'FIXED');
  assert.equal(body.currency, 'TRY');
  assert.equal(body.amountMinor, 150000);
  assert.equal(body.expiresAt, '2026-10-31T20:59:59.000Z');
  assert.equal(body.environment, undefined, 'the key decides the environment');
});

test('every payment-link call is signed: the routes accept the API-key signature only', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const images = imageResponder();
  const { client, calls, publicKey } = makeClient((call) => {
    if (call.url.includes('/qr')) return binaryResponse(200, png, 'image/png');
    if (call.url === STORAGE_URL || call.url.includes('/links/images')) return images(call);
    return jsonResponse(200, successEnvelope({ ...linkJson(), items: [], delivery: null, replayed: false }, {
      pageInfo: { hasMore: false, nextCursor: null },
    }));
  });
  const links = client.paymentLinks;
  const invocations = {
    create: () => links.create(CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x'), 'plink-lock-create'),
    list: () => links.list({ limit: 5 }),
    iterate: async () => { for await (const row of links.iterate()) void row; },
    get: () => links.get(LINK_ID),
    update: () => links.update(LINK_ID, 1, { title: 'y' }),
    pause: () => links.pause(LINK_ID),
    resume: () => links.resume(LINK_ID),
    deactivate: () => links.deactivate(LINK_ID),
    action: () => links.action(LINK_ID, 'pause'),
    send: () => links.send(LINK_ID, { channel: 'EMAIL' }, 'plink-lock-send'),
    qr: () => links.qr(LINK_ID),
    listAttempts: () => links.listAttempts(LINK_ID),
    iterateAttempts: async () => { for await (const row of links.iterateAttempts(LINK_ID)) void row; },
    listPayments: () => links.listPayments(LINK_ID),
    iteratePayments: async () => { for await (const row of links.iteratePayments(LINK_ID)) void row; },
    createImageUpload: () => links.createImageUpload({ fileName: 'cover.png', contentType: 'image/png', sizeBytes: 4 }),
    confirmImageUpload: () => links.confirmImageUpload(ASSET_ID),
    uploadImage: () => links.uploadImage({ fileName: 'cover.png', contentType: 'image/png', content: png }),
  };

  // The lock covers the whole public surface: a method added later without an
  // entry above fails here instead of shipping unsigned.
  const methods = Object.getOwnPropertyNames(PaymentLinkClient.prototype).filter((name) => name !== 'constructor');
  assert.deepEqual([...methods].sort(), Object.keys(invocations).sort());

  for (const [name, invoke] of Object.entries(invocations)) {
    const before = calls.length;
    await invoke();
    assert.ok(calls.length > before, `${name} sent a request`);
    for (const call of calls.slice(before)) {
      if (call.url.startsWith(`${BASE_URL}/`)) {
        assert.equal(signatureGuardVerdict(call, publicKey), 'OK', `${name}: ${route(call)} must carry a valid API-key signature`);
      } else {
        // Only the image PUT leaves the gateway, and it must leave without the key's credentials.
        assert.equal(name, 'uploadImage', `${name} must not call a host other than the gateway (${call.url})`);
        assert.deepEqual(credentialHeaders(call), [], `${name}: the storage PUT must not carry gateway credentials`);
      }
    }
  }
});

test('the SignatureGuard stand-in rejects what the gateway rejects (negative controls)', async () => {
  const { client, calls, publicKey } = makeClient(() => jsonResponse(201, successEnvelope(linkJson())));
  await client.paymentLinks.create(CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x'), 'plink-negative-1');
  const call = calls[0];

  const indented = { ...call, body: JSON.stringify(JSON.parse(call.body), null, 2) };
  indented.headers = { ...call.headers, Digest: 'SHA-256=' + crypto.createHash('sha256').update(indented.body).digest('base64') };
  assert.equal(signatureGuardVerdict(indented, publicKey), 'INVALID_DIGEST');

  const retargeted = { ...call, url: `${call.url}?limit=1` };
  assert.equal(signatureGuardVerdict(retargeted, publicKey), 'INVALID_SIGNATURE');

  const bearerOnly = { ...call, headers: { Authorization: call.headers.Authorization, 'Content-Type': 'application/json' } };
  assert.equal(signatureGuardVerdict(bearerOnly, publicKey), 'AUTH_HEADERS_MISSING');

  const otherKey = crypto.createPublicKey(LunixiClient.generateKeyPair().publicKey);
  assert.equal(signatureGuardVerdict(call, otherKey), 'INVALID_SIGNATURE');
});

test('create requires a well-formed Idempotency-Key before any request is sent', async () => {
  const { client, calls, tokenCalls } = makeClient(() => jsonResponse(201, successEnvelope(linkJson())));
  const request = CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x');

  await assert.rejects(() => client.paymentLinks.create(request), ConfigurationError);
  await assert.rejects(() => client.paymentLinks.create(request, 'short'), /8-200 printable ASCII/);
  await assert.rejects(() => client.paymentLinks.create(request, 'has a space'), /8-200 printable ASCII/);
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
});

test('create rejects unknown fields locally (the gateway would answer 400)', async () => {
  const { client, calls } = makeClient(() => jsonResponse(201, successEnvelope(linkJson())));
  const body = { ...CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x').toJSON(), merchantId: 'org_x' };

  await assert.rejects(() => client.paymentLinks.create(body, 'plink-unknown-1'), /Unknown payment link create field\(s\): merchantId/);
  assert.equal(calls.length, 0);
});

test('a replayed create returns the stored link with replayed=true', async () => {
  const { client } = makeClient(() => jsonResponse(200, successEnvelope({ ...linkJson(), replayed: true })));
  const link = await client.paymentLinks.create(CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x'), 'plink-replay-1');
  assert.equal(link.replayed, true);
});

test('builders produce the contract body for OPEN and ITEMIZED links', () => {
  const open = CreatePaymentLinkRequest.open(PaymentLinkUsage.MULTI_USE, 'TRY', 'Bağış', {
    minAmountMinor: 1000,
    maxAmountMinor: 500000,
    suggestedAmountsMinor: [5000, 10000, 25000],
  }).withButtonLabelKey('DONATE').toJSON();
  assert.deepEqual(open, {
    usage: 'MULTI_USE',
    amountMode: 'OPEN',
    currency: 'TRY',
    title: 'Bağış',
    minAmountMinor: 1000,
    maxAmountMinor: 500000,
    suggestedAmountsMinor: [5000, 10000, 25000],
    buttonLabelKey: 'DONATE',
  });

  const itemized = CreatePaymentLinkRequest.itemized(PaymentLinkUsage.MULTI_USE, 'TRY', 'Etkinlik', [
    new PaymentLinkItem('Standart bilet', 45000).withItemKey('standard').withQuantityRange(0, 5).withCapacity(100),
  ])
    .addCustomField(new PaymentLinkCustomField('invoice_no', 'Fatura no', CustomFieldType.TEXT).withRequired().withMaxLength(32))
    .withCapacity(null)
    .toJSON();
  assert.deepEqual(itemized.items, [{
    name: 'Standart bilet', unitPriceMinor: 45000, itemKey: 'standard', minQuantity: 0, maxQuantity: 5, capacity: 100,
  }]);
  assert.deepEqual(itemized.customFields, [{
    key: 'invoice_no', label: 'Fatura no', fieldType: 'TEXT', required: true, maxLength: 32,
  }]);
  assert.equal(itemized.capacity, null);
});

test('every builder output key is a contract field (CreatePaymentLinkBody)', () => {
  const full = CreatePaymentLinkRequest.fixed('MULTI_USE', 1000, 'TRY', 'Tam')
    .withEnvironment('TEST')
    .withQuantity(1, 5)
    .withCapacity(100)
    .withDescription('d')
    .withImageAssetId('0b6f2c1e-9a4d-4e7b-8c3a-5d2f1e0a9b8c')
    .withSuccessMessage('ok')
    .withSuccessRedirectUrl('https://merchant.example/done')
    .withTaxNote('KDV dahil')
    .withLocale('tr')
    .withStartsAt(new Date('2026-10-01T00:00:00Z'))
    .withExpiresAt('2026-10-31T20:59:59.000Z')
    .withEventAt(null)
    .withButtonLabelKey('BUY')
    .withTermsAcceptanceRequired()
    .withBuyerFields({ name: 'REQUIRED', email: 'REQUIRED', phone: 'OPTIONAL', address: 'HIDDEN', identityNumber: 'HIDDEN' })
    .withCustomFields([new PaymentLinkCustomField('color', 'Renk', 'SELECT').withOptions(['Mavi', 'Kırmızı']).withHelpText('h')])
    .withRecipient({ email: 'a@example.com' })
    .withPrefill({ name: 'Ayşe', country: 'TR' })
    .withVerification(true)
    .withReminders(48, 2)
    .withCheckout({ requireThreeDs: true, paymentMethods: ['card'] })
    .withReference('INV-1')
    .withTags(['a'])
    .withBranchCode('b')
    .withSalesChannel('s')
    .withCampaign('c')
    .withAgentCode('ag')
    .withMerchantNotifyEmails(['finans@merchant.example'])
    .withMetadata({ k: 'v' })
    .toJSON();

  const allowed = new Set(['environment', ...PAYMENT_LINK_SPEC_FIELDS]);
  const extra = Object.keys(full).filter((key) => !allowed.has(key));
  assert.deepEqual(extra, [], 'the gateway runs forbidNonWhitelisted: an unknown key is a 400');
  assert.deepEqual(full.verification, { required: true, channel: 'EMAIL' });
  assert.deepEqual(full.reminders, { enabled: true, intervalHours: 48, maxCount: 2 });
});

test('builders reject decimal money and values outside the closed sets', () => {
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1500.5, 'TRY', 'x'), /minor units/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', '150000', 'TRY', 'x'), /minor units/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('ONCE', 1000, 'TRY', 'x'), /usage must be one of/);
  assert.throws(() => new CreatePaymentLinkRequest('SINGLE_USE', 'FREE', 'TRY', 'x'), /amountMode must be one of/);
  assert.throws(() => CreatePaymentLinkRequest.itemized('MULTI_USE', 'TRY', 'x', []), /at least one item/);
  assert.throws(() => new PaymentLinkCustomField('k', 'l', 'FILE'), /fieldType must be one of/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x').withMetadata({ a: 1 }), /values are strings/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x').withEnvironment('PROD'), /environment must be one of/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x').withLocale('de'), /locale must be one of tr, en/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x').withButtonLabelKey('ORDER'), /buttonLabelKey must be one of/);
  assert.throws(() => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x').withImageAssetId('logo.png'), /imageAssetId must be an asset id/);
  assert.throws(() => new PaymentLinkItem('Bilet', 1000).withImageAssetId('https://cdn.example/x.png'), /imageAssetId must be an asset id/);
});

test('nested objects are checked against the keys the gateway DTO declares', () => {
  const base = () => CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x');

  assert.throws(() => base().withBuyerFields({ fax: 'REQUIRED' }), /Unknown buyerFields field\(s\): fax/);
  assert.throws(() => base().withBuyerFields({ name: 'MANDATORY' }), /buyerFields\.name must be one of HIDDEN, OPTIONAL, REQUIRED/);
  assert.throws(() => base().withRecipient({ tckn: '11111111111' }), /Unknown recipient field\(s\): tckn/);
  assert.throws(() => base().withRecipient({ email: 42 }), /recipient\.email must be a string/);
  assert.throws(() => base().withPrefill({ fullName: 'Ada' }), /Unknown prefill field\(s\): fullName/);
  assert.throws(() => base().withPrefill('Ada'), /prefill must be an object/);

  const cleared = base().withBuyerFields(null).withRecipient(null).withPrefill(null).withButtonLabelKey(null).toJSON();
  assert.equal(cleared.buyerFields, null);
  assert.equal(cleared.recipient, null);
  assert.equal(cleared.prefill, null);
  assert.equal(cleared.buttonLabelKey, null);

  const full = base()
    .withBuyerFields({ name: 'REQUIRED', identityNumber: 'HIDDEN' })
    .withRecipient({ name: 'Ada Yılmaz', email: 'ada@example.com', phone: '+905321112233' })
    .withPrefill({ surname: 'Yılmaz', country: 'TR', zipCode: '34000' })
    .toJSON();
  assert.deepEqual(full.buyerFields, { name: 'REQUIRED', identityNumber: 'HIDDEN' });
  assert.deepEqual(full.recipient, { name: 'Ada Yılmaz', email: 'ada@example.com', phone: '+905321112233' });
  assert.deepEqual(full.prefill, { surname: 'Yılmaz', country: 'TR', zipCode: '34000' });
});

test('list sends filters as a signed query and reads rows from data.items and paging from top-level pageInfo', async () => {
  const { client, calls, publicKey } = makeClient(() => jsonResponse(200, successEnvelope(
    { items: [linkJson()], pageInfo: { hasMore: false, nextCursor: '' } },
    { pageInfo: { hasMore: true, nextCursor: 'cur/2+=', totalCount: 41 } },
  )));

  const page = await client.paymentLinks.list({
    limit: 10,
    state: [PaymentLinkState.ACTIVE, PaymentLinkState.PAUSED],
    includeTotal: true,
    createdFrom: new Date('2026-09-01T00:00:00Z'),
    ignored: 'x',
  });

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].shortCode, 'K7M2Q9XR4T');
  assert.equal(page.hasMore, true, 'top-level pageInfo is canonical');
  assert.equal(page.nextCursor, 'cur/2+=');
  assert.equal(page.totalCount, 41);

  const call = calls[0];
  assert.equal(call.method, 'GET');
  assert.equal(call.url, `${BASE_URL}/api/v1/payments/links?limit=10&includeTotal=true&state=ACTIVE%2CPAUSED&createdFrom=2026-09-01T00%3A00%3A00.000Z`);
  assert.equal(call.body, null);
  assert.equal(signatureGuardVerdict(call, publicKey), 'OK');
});

test('iterate follows cursors until hasMore is false', async () => {
  const pages = [
    successEnvelope({ items: [linkJson({ id: 'a' })] }, { pageInfo: { hasMore: true, nextCursor: 'c2' } }),
    successEnvelope({ items: [linkJson({ id: 'b' })] }, { pageInfo: { hasMore: false, nextCursor: null } }),
  ];
  const { client, calls } = makeClient(() => jsonResponse(200, pages.shift()));

  const ids = [];
  for await (const link of client.paymentLinks.iterate({ limit: 1 })) ids.push(link.id);

  assert.deepEqual(ids, ['a', 'b']);
  assert.match(calls[1].url, /cursor=c2/);
});

test('update sends only the changed keys plus expectedRowVersion; null clears a field', async () => {
  const { client, calls, publicKey } = makeClient(() => jsonResponse(200, successEnvelope(linkJson({ version: 2, rowVersion: 2 }))));

  const link = await client.paymentLinks.update(LINK_ID, 1, {
    title: 'Yeni başlık',
    successRedirectUrl: null,
    expiresAt: new Date('2026-12-31T20:59:59Z'),
    description: undefined,
  });

  assert.equal(link.rowVersion, 2);
  const call = calls[0];
  assert.equal(call.method, 'PATCH');
  assert.equal(call.url, `${BASE_URL}/api/v1/payments/links/${LINK_ID}`);
  assert.deepEqual(JSON.parse(call.body), {
    expectedRowVersion: 1,
    title: 'Yeni başlık',
    successRedirectUrl: null,
    expiresAt: '2026-12-31T20:59:59.000Z',
  });
  assert.equal(signatureGuardVerdict(call, publicKey), 'OK');
});

test('update refuses immutable, unknown and empty changes locally', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, successEnvelope(linkJson())));

  await assert.rejects(() => client.paymentLinks.update(LINK_ID, 1, { currency: 'USD' }), /'currency' is fixed/);
  await assert.rejects(() => client.paymentLinks.update(LINK_ID, 1, { state: 'PAUSED' }), /Unknown payment link update field/);
  await assert.rejects(() => client.paymentLinks.update(LINK_ID, 1, {}), /at least one changed field/);
  await assert.rejects(() => client.paymentLinks.update(LINK_ID, -1, { title: 'x' }), /expectedRowVersion/);
  assert.equal(calls.length, 0);
});

test('pause / resume / deactivate post the row version and reason to their action routes', async () => {
  const { client, calls } = makeClient((call) => jsonResponse(200, successEnvelope(linkJson({
    state: call.url.endsWith('/pause') ? 'PAUSED' : 'ACTIVE',
  }))));

  const paused = await client.paymentLinks.pause(LINK_ID, { expectedRowVersion: 3, reason: 'Stok sayımı' });
  await client.paymentLinks.resume(LINK_ID, { expectedRowVersion: 4 }, 'plink-resume-0001');
  await client.paymentLinks.deactivate(LINK_ID);

  assert.equal(paused.state, 'PAUSED');
  assert.deepEqual(calls.map(route), [
    `POST /api/v1/payments/links/${LINK_ID}/pause`,
    `POST /api/v1/payments/links/${LINK_ID}/resume`,
    `POST /api/v1/payments/links/${LINK_ID}/deactivate`,
  ]);
  assert.deepEqual(JSON.parse(calls[0].body), { expectedRowVersion: 3, reason: 'Stok sayımı' });
  assert.equal(calls[1].headers['Idempotency-Key'], 'plink-resume-0001');
  assert.deepEqual(JSON.parse(calls[2].body), {});
  await assert.rejects(() => client.paymentLinks.action(LINK_ID, 'delete'), /pause, resume, deactivate/);
});

test('send requires an Idempotency-Key and a known channel, and returns the delivery', async () => {
  const delivery = { id: 'dl_1', kind: 'REQUEST', channel: 'EMAIL', recipientMasked: 'a***@example.com', state: 'QUEUED' };
  const { client, calls } = makeClient(() => jsonResponse(200, successEnvelope({ delivery, replayed: false })));

  await assert.rejects(() => client.paymentLinks.send(LINK_ID, { channel: 'EMAIL' }), /Idempotency-Key is required/);
  await assert.rejects(() => client.paymentLinks.send(LINK_ID, { channel: 'WHATSAPP' }, 'plink-send-0001'), /channel must be one of/);
  await assert.rejects(() => client.paymentLinks.send(LINK_ID, { channel: 'EMAIL', locale: 'de' }, 'plink-send-0001'), /locale must be one of tr, en/);
  assert.equal(calls.length, 0);

  const result = await client.paymentLinks.send(
    LINK_ID,
    { channel: PaymentLinkDeliveryChannel.EMAIL, recipientEmail: 'ayse@example.com', locale: 'tr' },
    'plink-send-0001',
  );
  assert.deepEqual(result, { delivery, replayed: false });
  assert.deepEqual(JSON.parse(calls[0].body), { channel: 'EMAIL', recipientEmail: 'ayse@example.com', locale: 'tr' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'plink-send-0001');
});

test('qr returns the raw image bytes and content type (not parsed as JSON)', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const { client, calls } = makeClient(() => binaryResponse(200, png, 'image/png'));

  const image = await client.paymentLinks.qr(LINK_ID, { format: 'png', size: 1024 });

  assert.equal(image.contentType, 'image/png');
  assert.ok(Buffer.isBuffer(image.data));
  assert.deepEqual([...image.data], [...png]);
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/payments/links/${LINK_ID}/qr?format=png&size=1024`);
  assert.match(calls[0].headers.Accept, /image\/png/);
  await assert.rejects(() => client.paymentLinks.qr(LINK_ID, { format: 'gif' }), /QR format/);
  await assert.rejects(() => client.paymentLinks.qr(LINK_ID, { size: 64 }), /128-2048/);
});

test('a QR error is still read as a JSON error', async () => {
  const { client } = makeClient(() => jsonResponse(404, { status: 'failure', code: 'payment_link.link.not_found', message: 'Not found' }));
  await assert.rejects(() => client.paymentLinks.qr(LINK_ID), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, 'payment_link.link.not_found');
    return true;
  });
});

test('attempts and payments are cursor pages under the link', async () => {
  const { client, calls } = makeClient((call) => jsonResponse(200, successEnvelope(
    { items: [call.url.includes('/attempts') ? { id: 'at_1', state: 'SUCCEEDED' } : { attemptId: 'at_1', paymentId: 'pi_1' }] },
    { pageInfo: { hasMore: false, nextCursor: '' } },
  )));

  const attempts = await client.paymentLinks.listAttempts(LINK_ID, { state: ['SUCCEEDED', 'FAILED'], limit: 5 });
  const payments = await client.paymentLinks.listPayments(LINK_ID, { limit: 5, state: 'ignored' });

  assert.equal(attempts.items[0].id, 'at_1');
  assert.equal(attempts.nextCursor, null);
  assert.equal(payments.items[0].attemptId, 'at_1');
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/payments/links/${LINK_ID}/attempts?limit=5&state=SUCCEEDED%2CFAILED`);
  assert.equal(calls[1].url, `${BASE_URL}/api/v1/payments/links/${LINK_ID}/payments?limit=5`);
});

test('a 401 re-mints the token once and re-signs with a fresh nonce; a second 401 surfaces', async () => {
  const { client, calls, tokenCalls, publicKey } = makeClient(() => jsonResponse(401, {
    status: 'failure', code: 'INVALID_SIGNATURE', message: 'Signature verification failed',
  }));

  await assert.rejects(() => client.paymentLinks.get(LINK_ID), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, 'INVALID_SIGNATURE');
    return true;
  });
  assert.equal(calls.length, 2);
  assert.equal(tokenCalls.length, 2);
  assert.notEqual(calls[0].headers['X-Nonce'], calls[1].headers['X-Nonce'], 'a nonce is never reused (replay guard)');
  for (const call of calls) assert.equal(signatureGuardVerdict(call, publicKey), 'OK');
});

test('gateway errors surface the payment_link code and details', async () => {
  const failure = {
    status: 'failure',
    code: 'payment_link.validation.invalid',
    message: 'Validation failed',
    statusCode: 422,
    details: { errors: [{ field: 'title', reason: 'too_long' }] },
  };
  const { client } = makeClient(() => jsonResponse(422, failure, { 'x-request-id': 'req_9' }));

  await assert.rejects(
    () => client.paymentLinks.create(CreatePaymentLinkRequest.fixed('SINGLE_USE', 1000, 'TRY', 'x'), 'plink-invalid-1'),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.ok(!(error instanceof ValidationError), '422 is a semantic rejection, not a malformed body');
      assert.equal(error.code, 'payment_link.validation.invalid');
      assert.deepEqual(error.response.details.errors, [{ field: 'title', reason: 'too_long' }]);
      assert.equal(error.requestId, 'req_9');
      return true;
    },
  );
});

test('link ids are required and path-encoded', async () => {
  const { client, calls } = makeClient(() => jsonResponse(404, { status: 'failure', code: 'payment_link.link.not_found' }));
  await assert.rejects(() => client.paymentLinks.get(''), ConfigurationError);
  await assert.rejects(() => client.paymentLinks.get('a/b?c'), ApiError);
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/payments/links/a%2Fb%3Fc`);
});

// --- Link images ---------------------------------------------------------------------

const IMAGE = { fileName: 'kapak.png', contentType: PaymentLinkImageContentType.PNG, sizeBytes: 12345 };

test('createImageUpload declares the file in a signed POST to /images and returns the upload target', async () => {
  const { client, calls, publicKey } = makeClient(imageResponder());

  const target = await client.paymentLinks.createImageUpload(IMAGE);

  assert.deepEqual(target, uploadTarget());
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(route(call), 'POST /api/v1/payments/links/images');
  assert.deepEqual(JSON.parse(call.body), { fileName: 'kapak.png', contentType: 'image/png', sizeBytes: 12345 });
  assert.equal(call.headers['Idempotency-Key'], undefined, 'the route takes no Idempotency-Key');
  assert.equal(signatureGuardVerdict(call, publicKey), 'OK');
});

test('createImageUpload refuses a declaration the gateway rejects, before any request', async () => {
  const { client, calls, tokenCalls } = makeClient(imageResponder());
  const refused = [
    [{ contentType: 'image/svg+xml' }, /SVG is not accepted/],
    [{ contentType: 'image/gif' }, /contentType must be one of image\/png, image\/jpeg, image\/webp/],
    [{ sizeBytes: 0 }, /positive integer/],
    [{ sizeBytes: 1.5 }, /positive integer/],
    [{ sizeBytes: '12345' }, /positive integer/],
    [{ fileName: ' ' }, /fileName is required/],
  ];

  for (const [change, message] of refused) {
    await assert.rejects(() => client.paymentLinks.createImageUpload({ ...IMAGE, ...change }), message);
  }
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
});

test('an upload target the SDK cannot PUT to is an ApiError, not a target', async () => {
  const unusable = [
    uploadTarget({ uploadUrl: undefined }),
    uploadTarget({ uploadUrl: 'ftp://storage.invalid/object' }),
    uploadTarget({ uploadUrl: '/relative/object' }),
    uploadTarget({ uploadMethod: 'POST' }),
    uploadTarget({ uploadHeaders: ['Content-Type: image/png'] }),
    uploadTarget({ uploadHeaders: { 'Content-Length': 12 } }),
    uploadTarget({ assetId: 'org_1/general/object.png' }),
  ];

  for (const target of unusable) {
    const { client } = makeClient(() => jsonResponse(201, successEnvelope(target)));
    await assert.rejects(() => client.paymentLinks.createImageUpload(IMAGE), (error) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /usable upload target/);
      assert.deepEqual(error.response, JSON.parse(JSON.stringify(target)), 'the answer is kept for diagnosis');
      return true;
    }, JSON.stringify(target));
  }
});

test('confirmImageUpload posts a signed empty body and resolves only with a published image', async () => {
  const { client, calls, publicKey } = makeClient(imageResponder());

  const image = await client.paymentLinks.confirmImageUpload(ASSET_ID);

  assert.deepEqual(image, publishedImage());
  assert.equal(route(calls[0]), `POST /api/v1/payments/links/images/${ASSET_ID}/confirm`);
  assert.deepEqual(JSON.parse(calls[0].body), {});
  assert.equal(signatureGuardVerdict(calls[0], publicKey), 'OK');

  await assert.rejects(() => client.paymentLinks.confirmImageUpload('../../links'), ConfigurationError);
  await assert.rejects(() => client.paymentLinks.confirmImageUpload(undefined), ConfigurationError);
  assert.equal(calls.length, 1, 'an id that is not an asset id is never sent');

  for (const answer of [publishedImage({ state: 'UPLOADING' }), publishedImage({ assetId: null }), null]) {
    const { client: other } = makeClient(() => jsonResponse(200, successEnvelope(answer)));
    await assert.rejects(() => other.paymentLinks.confirmImageUpload(ASSET_ID), /did not return a published image/);
  }
});

test('uploadImage PUTs the bytes to the storage URL with only the upload headers: no access token, no signature', async () => {
  const { client, calls, publicKey } = makeClient(imageResponder());

  const image = await client.paymentLinks.uploadImage({ fileName: 'kapak.png', contentType: 'image/png', content: PNG });

  assert.deepEqual(image, publishedImage());
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    `POST ${BASE_URL}/api/v1/payments/links/images`,
    `PUT ${STORAGE_URL}`,
    `POST ${BASE_URL}/api/v1/payments/links/images/${ASSET_ID}/confirm`,
  ]);
  const [create, put, confirm] = calls;
  assert.equal(JSON.parse(create.body).sizeBytes, PNG.length, 'the declared size is the content length');
  assert.equal(signatureGuardVerdict(create, publicKey), 'OK');
  assert.equal(signatureGuardVerdict(confirm, publicKey), 'OK');

  assert.deepEqual(put.headers, { 'Content-Type': 'image/png' }, 'exactly the upload headers the URL was signed for');
  assert.deepEqual(credentialHeaders(put), []);
  assert.deepEqual([...put.body], [...PNG]);
  // The detector is not blind: it flags every credential on a request the gateway client built.
  assert.deepEqual(credentialHeaders(create).sort(), ['Authorization', 'Digest', 'X-Date', 'X-Key-Id', 'X-Nonce', 'X-Signature']);
});

test('uploadImage takes an ArrayBuffer and refuses empty or non-binary content before any request', async () => {
  const { client, calls, tokenCalls } = makeClient(imageResponder());

  for (const content of [Buffer.alloc(0), new ArrayBuffer(0), PNG.toString('base64'), undefined]) {
    await assert.rejects(
      () => client.paymentLinks.uploadImage({ fileName: 'kapak.png', contentType: 'image/png', content }),
      /non-empty Buffer, Uint8Array or ArrayBuffer/,
    );
  }
  assert.equal(calls.length + tokenCalls.length, 0);

  const arrayBuffer = PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength);
  await client.paymentLinks.uploadImage({ fileName: 'kapak.png', contentType: 'image/png', content: arrayBuffer });
  assert.equal(JSON.parse(calls[0].body).sizeBytes, PNG.length);
  assert.deepEqual([...calls[1].body], [...PNG]);
});

test('a failed storage PUT rejects with the storage status and code, and nothing is confirmed', async () => {
  const expired = '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>';
  const { client, calls } = makeClient(imageResponder(() => storageResponse(403, expired)));

  await assert.rejects(() => client.paymentLinks.uploadImage({ fileName: 'kapak.png', contentType: 'image/png', content: PNG }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'AccessDenied');
    assert.match(error.message, /HTTP 403, AccessDenied/);
    return true;
  });
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'PUT'], 'the image is not confirmed after a failed upload');

  const unreachable = makeClient(imageResponder(() => { throw new TypeError('fetch failed'); }));
  await assert.rejects(
    () => unreachable.client.paymentLinks.uploadImage({ fileName: 'kapak.png', contentType: 'image/png', content: PNG }),
    (error) => error instanceof ApiError && /storage failed: fetch failed/.test(error.message) && error.cause instanceof TypeError,
  );
  assert.deepEqual(unreachable.calls.map((call) => call.method), ['POST', 'PUT'], 'a PUT that never landed is not retried or confirmed');
});
