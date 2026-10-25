'use strict';

/*
 * Contract source: nest-payment-gateway apps/api-gateway/src/insurance/
 * (api/insurance-api.controller.ts, api/insurance-api.service.ts, dtos/*.ts,
 * mappers/insurance-json.mapper.ts, mappers/insurance-reconciliation.mapper.ts,
 * insurance-reconciliation.export.ts, insurance-policy-document.response.ts,
 * insurance.constants.ts); apps/insurance-service/src/standards/
 * insurance-order-status.ts, insurance-reference-kinds.ts,
 * insurance-lead-standards.ts; webhook libs/proto/src/insurance-webhook.interface.ts.
 * Ids and values below are synthetic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LunixiClient,
  InsuranceClient,
  BasketItem,
  InsuranceItemCategory,
  WebhookVerifier,
  InsurancePremiumCollectedBy,
  InsuranceQuoteStatus,
  InsuranceOrderStatus,
  InsuranceCollectionStatus,
  InsurancePolicyStatus,
  InsuranceRefundStatus,
  InsuranceDocumentStatus,
  InsurancePaymentMode,
  InsuranceOrderSurface,
  InsuranceReferenceKind,
  InsuranceLeadStatus,
  InsuranceEvents,
  INSURANCE_EVENT_PATTERN,
  INSURANCE_EVENT_TYPES,
  INSURANCE_QUOTE_FIELDS,
  INSURANCE_LEAD_FIELDS,
  INSURANCE_FILTERS,
  ConfigurationError,
  ApiError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const PAYMENT_ID = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const CONNECTION_ID = '8d2f3e4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a';
const QUOTE_ID = `insq_${'a'.repeat(32)}`;
const ORDER_ID = `inso_${'b'.repeat(32)}`;
const POLICY_ID = `insp_${'c'.repeat(32)}`;
const LEAD_ID = `insl_${'f'.repeat(32)}`;
const KEY = 'insurance-test-key-0001';

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    text: async () => JSON.stringify(body),
  };
}

function binaryResponse(status, bytes, contentType) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', contentType]]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString('utf8'),
  };
}

function envelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', data, requestId: 'req_1', ...extra };
}

/** List envelope: rows in `data.items`, paging in the top-level `pageInfo`. */
function page(items, hasMore = false, nextCursor = null) {
  return envelope({ items }, { pageInfo: { hasMore, nextCursor } });
}

/**
 * SignatureGuard (apps/api-gateway/src/auth/guards/signature.guard.ts): METHOD,
 * request target, X-Date, X-Nonce and Digest when present; the Digest must be
 * the SHA-256 of the body that was sent.
 */
function signatureGuardVerdict(call, publicKey) {
  const h = call.headers;
  if (!h['X-Key-Id'] || !h['X-Date'] || !h['X-Nonce'] || !h['X-Signature']) return 'AUTH_HEADERS_MISSING';
  if (Math.abs(Date.now() - new Date(h['X-Date']).getTime()) > 300000) return 'INVALID_DATE';
  if (call.body !== null && call.body !== undefined) {
    const expected = `SHA-256=${crypto.createHash('sha256').update(call.body).digest('base64')}`;
    if (h.Digest !== expected) return 'DIGEST_MISMATCH';
  }
  const lines = [call.method.toUpperCase(), call.url.slice(BASE_URL.length), `X-Date:${h['X-Date']}`, `X-Nonce:${h['X-Nonce']}`];
  if (h.Digest) lines.push(`Digest:${h.Digest}`);
  const ok = crypto.verify(null, Buffer.from(lines.join('\n')), publicKey, Buffer.from(h['X-Signature'], 'base64'));
  return ok ? 'OK' : 'INVALID_SIGNATURE';
}

function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const publicKey = crypto.createPublicKey(keys.publicKey);
  const calls = [];
  const fetch = async (url, options = {}) => {
    const call = { url: String(url), ...options };
    if (call.url === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at_test_1', expires_in: 1800 });
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_test_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 0 });
  return { client, insurance: client.insurance, calls, publicKey };
}

function target(call) {
  return call.url.slice(BASE_URL.length);
}

function queryOf(call) {
  return Object.fromEntries(new URL(call.url).searchParams.entries());
}

function bodyOf(call) {
  return call.body === null || call.body === undefined ? null : JSON.parse(call.body);
}

const ticketItem = () => new BasketItem({
  id: 'ticket-1',
  price: 100000,
  name: 'Sample ticket',
  category1: 'ticket',
  itemType: BasketItem.TYPE_VIRTUAL,
  insuranceCategory: InsuranceItemCategory.TICKET,
  insuranceTypes: ['TICKET_CANCELLATION'],
});

const quoteOption = (overrides = {}) => ({
  quoteId: QUOTE_ID, insuranceType: 'TICKET_CANCELLATION', schemaVersion: 1, title: 'Ticket cancellation',
  premiumAmount: 4900, currency: 'TRY', premiumCollectedBy: 'MERCHANT',
  provider: { code: 'SAMPLE', name: 'Sample', logoUrl: null, connectionId: CONNECTION_ID },
  basketItemIds: ['ticket-1'], coverageSummary: [], terms: { version: 'v1', sha256: 'd'.repeat(64) },
  underwriterName: null, expiresAt: '2026-01-01T07:15:00.000Z', status: 'QUOTED', paymentIntentId: null,
  createdAt: '2026-01-01T07:00:00.000Z', ...overrides,
});

const orderJson = (overrides = {}) => ({
  orderId: ORDER_ID, quoteId: QUOTE_ID, insuranceType: 'TICKET_CANCELLATION', surface: 'MERCHANT_API', status: 'CREATED',
  collectionStatus: 'NOT_STARTED', policyStatus: 'NOT_REQUESTED', refundStatus: 'NONE', documentStatus: 'NOT_AVAILABLE',
  paymentMode: 'NO_PAYMENT', premiumCollectedBy: 'MERCHANT', premiumAmount: 4900, currency: 'TRY', paymentIntentId: null,
  merchantOrderId: 'ORD-1', provider: { code: 'SAMPLE', name: 'Sample', logoUrl: null, connectionId: CONNECTION_ID },
  basketItemIds: ['ticket-1'], policies: [], errorCode: null, refundErrorCode: null, refundedAt: null,
  createdAt: '2026-01-01T07:00:00.000Z', updatedAt: '2026-01-01T07:00:00.000Z', ...overrides,
});

const leadJson = (overrides = {}) => ({
  leadId: LEAD_ID, insuranceType: 'CARGO_TRANSIT', schemaVersion: 1, status: 'SUBMITTED', errorCode: null,
  requestMasked: { policyholder: { identityNumber: '***' }, shipment: { originCityCode: '35', destinationCityCode: '06' }, note: '***' },
  submittedAt: '2026-01-01T07:00:01.000Z', createdAt: '2026-01-01T07:00:00.000Z', updatedAt: '2026-01-01T07:00:01.000Z', ...overrides,
});

/** A lead body: synthetic values, the field names of the CARGO_TRANSIT lead schema v1. */
const leadRequest = () => ({
  insuranceType: 'CARGO_TRANSIT',
  policyholder: { identityType: 'TCKN', identityNumber: 'SAMPLE', birthDate: '1990-01-01', email: 'lead@example.com', phone: '+905000000000' },
  company: { identityType: 'VKN', identityNumber: 'SAMPLE' },
  shipment: {
    cargoDescription: 'Sample goods', carrierVehicle: 'TRUCK', invoiceAmount: 1000000, consigneeName: 'Sample Consignee',
    originCityCode: '35', destinationCityCode: '06', departureDate: '2026-01-02',
  },
  vehicle: { plate: 'SAMPLE', registrationDocument: { serial: 'AA', number: '000000' } },
  note: '  Kept as given  ',
});

const RECONCILIATION = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

test('client.insurance is an InsuranceClient', () => {
  const { insurance } = makeClient(() => jsonResponse(200, envelope({})));
  assert.ok(insurance instanceof InsuranceClient);
});

test('every insurance call is signed, hits its route and sends the Idempotency-Key it needs', async () => {
  const { insurance, calls, publicKey } = makeClient((call) => {
    if (/\/(document|receipt|certificate)$/.test(target(call))) return binaryResponse(200, Buffer.from('%PDF-1.7'), 'application/pdf');
    if (call.url.includes('/export')) return binaryResponse(200, Buffer.from('﻿orderId\r\n'), 'text/csv; charset=utf-8');
    if (/\/(reference\/[A-Z_]+|orders|reconciliation\/orders|leads)(\?|$)/.test(target(call)) && call.method === 'GET') return jsonResponse(200, page([]));
    if (target(call).includes('/leads')) return jsonResponse(200, envelope(leadJson()));
    return jsonResponse(200, envelope(orderJson()));
  });
  const drain = async (iterator) => { for await (const row of iterator) void row; };
  const quote = { insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: [ticketItem()] }, tickets: [{}] };
  const consent = { termsVersion: 'v1', termsSha256: 'd'.repeat(64), acceptedAt: '2026-01-01T07:01:00Z' };
  const payment = { externalPaymentId: 'pay-1', paidAmount: 4900, paidCurrency: 'TRY', paidAt: '2026-01-01T07:02:00Z' };
  const invocations = {
    listProducts: ['GET /api/v1/insurance/products', null, () => insurance.listProducts({ currency: 'TRY', paymentIntentId: PAYMENT_ID })],
    searchProducts: ['POST /api/v1/insurance/products', null, () => insurance.searchProducts({ currency: 'TRY', context: { items: [ticketItem()] } })],
    listReferenceValues: ['GET /api/v1/insurance/reference/CITY', null, () => insurance.listReferenceValues('CITY')],
    iterateReferenceValues: ['GET /api/v1/insurance/reference/DISTRICT', null, () => drain(insurance.iterateReferenceValues('DISTRICT', { parentCode: '34' }))],
    createQuote: ['POST /api/v1/insurance/quotes', 'optional', () => insurance.createQuote(quote, KEY)],
    getQuote: [`GET /api/v1/insurance/quotes/${QUOTE_ID}`, null, () => insurance.getQuote(QUOTE_ID)],
    createOrder: ['POST /api/v1/insurance/orders', 'required', () => insurance.createOrder({ quoteId: QUOTE_ID, consent }, KEY)],
    listOrders: ['GET /api/v1/insurance/orders', null, () => insurance.listOrders()],
    iterateOrders: ['GET /api/v1/insurance/orders', null, () => drain(insurance.iterateOrders())],
    getOrder: [`GET /api/v1/insurance/orders/${ORDER_ID}`, null, () => insurance.getOrder(ORDER_ID)],
    bindPayment: [`POST /api/v1/insurance/orders/${ORDER_ID}/bind-payment`, 'optional', () => insurance.bindPayment(ORDER_ID, PAYMENT_ID, KEY)],
    confirmPayment: [`POST /api/v1/insurance/orders/${ORDER_ID}/confirm-payment`, 'required', () => insurance.confirmPayment(ORDER_ID, payment, KEY)],
    issuePolicy: [`POST /api/v1/insurance/orders/${ORDER_ID}/issue-policy`, 'required', () => insurance.issuePolicy(ORDER_ID, KEY)],
    cancelOrder: [`POST /api/v1/insurance/orders/${ORDER_ID}/cancel`, 'required', () => insurance.cancelOrder(ORDER_ID, KEY)],
    refundPremium: [`POST /api/v1/insurance/orders/${ORDER_ID}/refund-premium`, 'required', () => insurance.refundPremium(ORDER_ID, {}, KEY)],
    createLead: ['POST /api/v1/insurance/leads', 'required', () => insurance.createLead(leadRequest(), KEY)],
    listLeads: ['GET /api/v1/insurance/leads', null, () => insurance.listLeads()],
    iterateLeads: ['GET /api/v1/insurance/leads', null, () => drain(insurance.iterateLeads())],
    getLead: [`GET /api/v1/insurance/leads/${LEAD_ID}`, null, () => insurance.getLead(LEAD_ID)],
    getPolicyDocument: [`GET /api/v1/insurance/policies/${POLICY_ID}/document`, null, () => insurance.getPolicyDocument(POLICY_ID)],
    getPolicyReceipt: [`GET /api/v1/insurance/policies/${POLICY_ID}/receipt`, null, () => insurance.getPolicyReceipt(POLICY_ID)],
    getPolicyCertificate: [`GET /api/v1/insurance/policies/${POLICY_ID}/certificate`, null, () => insurance.getPolicyCertificate(POLICY_ID)],
    getReconciliationSummary: ['GET /api/v1/insurance/reconciliation/summary', null, () => insurance.getReconciliationSummary(RECONCILIATION)],
    listReconciliationOrders: ['GET /api/v1/insurance/reconciliation/orders', null, () => insurance.listReconciliationOrders(RECONCILIATION)],
    iterateReconciliationOrders: ['GET /api/v1/insurance/reconciliation/orders', null, () => drain(insurance.iterateReconciliationOrders(RECONCILIATION))],
    exportReconciliation: ['GET /api/v1/insurance/reconciliation/export', null, () => insurance.exportReconciliation(RECONCILIATION)],
  };

  // The lock covers the whole public surface: a method added later without an
  // entry above fails here instead of shipping unsigned.
  const methods = Object.getOwnPropertyNames(InsuranceClient.prototype).filter((name) => name !== 'constructor');
  assert.deepEqual([...methods].sort(), Object.keys(invocations).sort());

  for (const [name, [route, key, invoke]] of Object.entries(invocations)) {
    const before = calls.length;
    await invoke();
    assert.equal(calls.length, before + 1, `${name} sent one request`);
    const call = calls[calls.length - 1];
    assert.equal(`${call.method} ${target(call).split('?')[0]}`, route, name);
    assert.equal(signatureGuardVerdict(call, publicKey), 'OK', `${name} must carry a valid API-key signature`);
    assert.equal(call.headers['Idempotency-Key'], key ? KEY : undefined, `${name} Idempotency-Key`);
    if (call.method === 'GET') assert.equal(call.body, null, `${name} sends no body`);
  }
});

test('the five order writes and the lead refuse a missing or malformed Idempotency-Key before sending', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(200, envelope(orderJson())));
  const consent = { termsVersion: 'v1', termsSha256: 'd'.repeat(64), acceptedAt: '2026-01-01T07:01:00Z' };
  const payment = { externalPaymentId: 'pay-1', paidAmount: 4900, paidCurrency: 'TRY', paidAt: '2026-01-01T07:02:00Z' };
  const writes = [
    (key) => insurance.createOrder({ quoteId: QUOTE_ID, consent }, key),
    (key) => insurance.confirmPayment(ORDER_ID, payment, key),
    (key) => insurance.issuePolicy(ORDER_ID, key),
    (key) => insurance.cancelOrder(ORDER_ID, key),
    (key) => insurance.refundPremium(ORDER_ID, {}, key),
    (key) => insurance.createLead(leadRequest(), key),
  ];
  for (const write of writes) {
    for (const key of [undefined, '', 'short', 'has a space in it', 'x'.repeat(201)]) {
      await assert.rejects(() => write(key), ConfigurationError);
    }
  }
  await assert.rejects(() => insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID }, 'short'), ConfigurationError);
  await assert.rejects(() => insurance.bindPayment(ORDER_ID, PAYMENT_ID, 'has a space in it'), ConfigurationError);
  assert.equal(calls.length, 0);
});

test('createQuote takes at most one basket source and keeps the type object as given', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(201, envelope({ insuranceType: 'TICKET_CANCELLATION', schemaVersion: 1, options: [quoteOption()] }, { statusCode: 201 })));
  const tickets = [{ basketItemId: 'ticket-1', transportMode: 'TRAIN', carrier: 'Sample Rail', priceAmount: 100000 }];
  const insured = [{ identityType: 'PASSPORT', identityNumber: 'SAMPLE', birthDate: '2000-01-01' }];
  const set = await insurance.createQuote({
    insuranceType: 'TICKET_CANCELLATION', currency: 'try', context: { items: [ticketItem()] }, insured, tickets, merchantOrderId: 'ORD-1',
  });
  assert.equal(set.options[0].quoteId, QUOTE_ID);
  assert.deepEqual(bodyOf(calls[0]), {
    insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: [ticketItem().toJSON()] }, insured, tickets, merchantOrderId: 'ORD-1',
  });
  assert.equal(calls[0].headers['Idempotency-Key'], undefined);

  await insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, schemaVersion: 1 });
  assert.deepEqual(bodyOf(calls[1]), { insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, schemaVersion: 1 });

  // Sold without a basket item: neither source, the type object carries the cover.
  const accident = { coverageStartDate: '2026-01-02' };
  await insurance.createQuote({ insuranceType: 'PERSONAL_ACCIDENT', currency: 'TRY', insured, accident });
  assert.deepEqual(bodyOf(calls[2]), { insuranceType: 'PERSONAL_ACCIDENT', currency: 'TRY', insured, accident });

  const invalid = [
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, context: { items: [ticketItem()] } }, /not both/],
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, teklifId: 'x' }, /Unknown createQuote request field/],
    [{ currency: 'TRY', paymentIntentId: PAYMENT_ID }, /insuranceType is required/],
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TL', paymentIntentId: PAYMENT_ID }, /'currency'/],
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: 'pay_1' }, /'paymentIntentId'/],
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: [] } }, /1 to 100/],
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: Array(101).fill(ticketItem()) } }, /1 to 100/],
    [{ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: [ticketItem()], paymentIntentId: PAYMENT_ID } }, /Unknown context field/],
  ];
  for (const [request, message] of invalid) {
    await assert.rejects(() => insurance.createQuote(request), (error) => error instanceof ConfigurationError && message.test(error.message), JSON.stringify(request));
  }
  assert.equal(calls.length, 3);
});

test('a quote set carries the insurance company and the options left out', async () => {
  const underwriter = { code: 'SAMPLE_CO', name: 'Sample Insurance', logoUrl: null, disclosureText: 'Sample text.' };
  const excluded = {
    underwriter: { code: 'OTHER_CO', name: 'Other Insurance', logoUrl: null, disclosureText: null },
    provider: { code: 'SAMPLE', name: 'Sample', logoUrl: null, connectionId: CONNECTION_ID },
    errorCode: 'insurance.validation.invalid',
    errors: [{ field: 'insured[0].birthDate', reason: 'required' }],
  };
  const answer = { insuranceType: 'TICKET_CANCELLATION', schemaVersion: 1, options: [quoteOption({ underwriter })], excludedOptions: [excluded] };
  const { insurance } = makeClient(() => jsonResponse(201, envelope(answer, { statusCode: 201 })));
  const set = await insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: [ticketItem()] } });
  assert.deepEqual(set.options[0].underwriter, underwriter);
  assert.equal(set.options[0].underwriterName, null, 'underwriterName stays next to underwriter');
  assert.deepEqual(set.excludedOptions, [excluded]);
});

test('a 422 validation error keeps every field error for the caller', async () => {
  const details = { errors: [{ field: 'tickets[0].departureAt', reason: 'required' }, { field: 'insured[0].birthDate', reason: 'invalid_format' }] };
  const { insurance } = makeClient(() => jsonResponse(422, { status: 'error', code: 'insurance.validation.invalid', message: 'Invalid.', statusCode: 422, details }));
  await assert.rejects(
    () => insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, tickets: [{}] }),
    (error) => error instanceof ApiError && error.statusCode === 422 && error.code === 'insurance.validation.invalid'
      && JSON.stringify(error.response.details) === JSON.stringify(details),
  );
});

test('createOrder sends the consent; consentFromQuote copies the terms unchanged', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(201, envelope(orderJson(), { statusCode: 201 })));
  const consent = InsuranceClient.consentFromQuote(quoteOption(), new Date('2026-01-01T07:01:00.000Z'));
  assert.deepEqual(consent, { termsVersion: 'v1', termsSha256: 'd'.repeat(64), acceptedAt: '2026-01-01T07:01:00.000Z' });
  const order = await insurance.createOrder({ quoteId: QUOTE_ID, merchantOrderId: 'ORD-1', consent }, KEY);
  assert.equal(order.orderId, ORDER_ID);
  assert.deepEqual(bodyOf(calls[0]), { quoteId: QUOTE_ID, merchantOrderId: 'ORD-1', consent });

  await assert.rejects(() => insurance.createOrder({ quoteId: QUOTE_ID }, KEY), /consent must be an object/);
  await assert.rejects(() => insurance.createOrder({ quoteId: QUOTE_ID, consent: { ...consent, acceptedAt: undefined } }, KEY), /consent.acceptedAt/);
  await assert.rejects(() => insurance.createOrder({ quoteId: QUOTE_ID, consent: { ...consent, ip: '127.0.0.1' } }, KEY), /Unknown consent field/);
  assert.throws(() => InsuranceClient.consentFromQuote({ quoteId: QUOTE_ID }, new Date()), ConfigurationError);
  assert.throws(() => InsuranceClient.consentFromQuote(quoteOption(), new Date('invalid')), /invalid Date/);
  assert.equal(calls.length, 1);
});

test('premiumBasketItem is the VIRTUAL premium line of a MERCHANT order and carries no insurance field', () => {
  const item = InsuranceClient.premiumBasketItem(orderJson(), { name: 'Ticket cancellation insurance', category1: 'insurance' });
  assert.ok(item instanceof BasketItem);
  assert.deepEqual(item.toJSON(), {
    id: ORDER_ID, price: 4900, name: 'Ticket cancellation insurance', category1: 'insurance', itemType: 'VIRTUAL',
  });
  assert.equal(Object.keys(item.toJSON()).some((key) => key.startsWith('insurance')), false);
  assert.throws(() => InsuranceClient.premiumBasketItem(orderJson({ premiumCollectedBy: 'PROVIDER' }), { name: 'x', category1: 'y' }), /premiumCollectedBy MERCHANT/);
  assert.throws(() => InsuranceClient.premiumBasketItem(orderJson(), { category1: 'insurance' }), /name is required/);
  assert.throws(() => InsuranceClient.premiumBasketItem(orderJson({ premiumAmount: 0 }), { name: 'x', category1: 'y' }), /premiumAmount/);
});

test('bindPayment, confirmPayment and refundPremium send the DTO bodies', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(200, envelope(orderJson())));
  await insurance.bindPayment(ORDER_ID, PAYMENT_ID);
  await insurance.confirmPayment(ORDER_ID, {
    externalPaymentId: 'pay-1', paidAmount: 4900, paidCurrency: 'try', paidAt: new Date('2026-01-01T07:02:00.000Z'), paymentProvider: 'Own POS',
  }, KEY);
  await insurance.refundPremium(ORDER_ID, undefined, KEY);
  await insurance.refundPremium(ORDER_ID, { externalRefund: { externalRefundId: 'refund-1', refundedAt: '2026-01-02T07:00:00+03:00' } }, KEY);
  await insurance.issuePolicy(ORDER_ID, KEY);
  assert.deepEqual(bodyOf(calls[0]), { paymentIntentId: PAYMENT_ID });
  assert.equal(calls[0].headers['Idempotency-Key'], undefined);
  assert.deepEqual(bodyOf(calls[1]), {
    payment: { externalPaymentId: 'pay-1', paidAmount: 4900, paidCurrency: 'TRY', paidAt: '2026-01-01T07:02:00.000Z', paymentProvider: 'Own POS' },
  });
  assert.deepEqual(bodyOf(calls[2]), {}, 'a Lunixi-payment refund has an empty body');
  assert.deepEqual(bodyOf(calls[3]), { externalRefund: { externalRefundId: 'refund-1', refundedAt: '2026-01-02T07:00:00+03:00' } });
  assert.equal(calls[4].body, null, 'issue-policy has no body');

  const invalid = [
    () => insurance.confirmPayment(ORDER_ID, { externalPaymentId: 'pay-1', paidAmount: 49.5, paidCurrency: 'TRY', paidAt: '2026-01-01T07:02:00Z' }, KEY),
    () => insurance.confirmPayment(ORDER_ID, { externalPaymentId: 'pay-1', paidAmount: 4900, paidCurrency: 'TRY' }, KEY),
    () => insurance.confirmPayment(ORDER_ID, { externalPaymentId: 'pay-1', paidAmount: 4900, paidCurrency: 'TRY', paidAt: '2026-01-01T07:02:00Z', cardLast4: '0000' }, KEY),
    () => insurance.refundPremium(ORDER_ID, { externalRefund: { externalRefundId: 'refund-1' } }, KEY),
    () => insurance.refundPremium(ORDER_ID, { reason: 'x' }, KEY),
    () => insurance.bindPayment(ORDER_ID, 'not-a-uuid'),
    () => insurance.getOrder('  '),
  ];
  for (const invoke of invalid) await assert.rejects(invoke, ConfigurationError);
  assert.equal(calls.length, 5);
});

test('createLead sends the lead schema fields as given and returns the lead (201)', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(201, envelope(leadJson(), { statusCode: 201 })));
  const lead = await insurance.createLead({ ...leadRequest(), schemaVersion: 1 }, KEY);
  assert.deepEqual(lead, leadJson());
  assert.deepEqual(bodyOf(calls[0]), { ...leadRequest(), schemaVersion: 1 }, 'the type objects and the note are sent unchanged');
  assert.equal(calls[0].headers['Idempotency-Key'], KEY);

  // Trafik / Kasko leads: the person and the vehicle, no shipment.
  const motor = { insuranceType: 'MOTOR_COMPREHENSIVE', policyholder: leadRequest().policyholder, vehicle: leadRequest().vehicle };
  await insurance.createLead(motor, KEY);
  assert.deepEqual(bodyOf(calls[1]), motor);

  const invalid = [
    [{ ...leadRequest(), currency: 'TRY' }, /Unknown createLead request field/],
    [{ ...leadRequest(), paymentIntentId: PAYMENT_ID }, /Unknown createLead request field/],
    [{ ...leadRequest(), context: { items: [ticketItem()] } }, /Unknown createLead request field/],
    [{ ...leadRequest(), insuranceType: undefined }, /insuranceType is required/],
    [{ ...leadRequest(), note: 42 }, /'note' must be a string/],
    [{ ...leadRequest(), note: 'x'.repeat(1001) }, /at most 1000/],
  ];
  for (const [request, message] of invalid) {
    await assert.rejects(() => insurance.createLead(request, KEY), (error) => error instanceof ConfigurationError && message.test(error.message), JSON.stringify(Object.keys(request)));
  }
  assert.equal(calls.length, 2);
});

test('a refused lead keeps its code and the lead id', async () => {
  const { insurance } = makeClient(() => jsonResponse(422, {
    status: 'error', code: 'insurance.lead.rejected', message: 'Rejected.', statusCode: 422, details: { leadId: LEAD_ID },
  }));
  await assert.rejects(() => insurance.createLead(leadRequest(), KEY), (error) => error instanceof ApiError
    && error.statusCode === 422 && error.code === 'insurance.lead.rejected' && error.response.details.leadId === LEAD_ID);
});

test('leads are listed with their filters and read one by one', async () => {
  const answers = [page([leadJson()], true, 'cursor-2'), page([leadJson({ leadId: `insl_${'9'.repeat(32)}`, status: 'UNKNOWN', submittedAt: null })]), envelope(leadJson())];
  const { insurance, calls } = makeClient(() => jsonResponse(200, answers.shift()));
  const statuses = [];
  for await (const lead of insurance.iterateLeads({ limit: 1, insuranceType: 'CARGO_TRANSIT', status: InsuranceLeadStatus.SUBMITTED })) statuses.push(lead.status);
  assert.deepEqual(statuses, ['SUBMITTED', 'UNKNOWN']);
  assert.deepEqual(queryOf(calls[0]), { limit: '1', insuranceType: 'CARGO_TRANSIT', status: 'SUBMITTED' });
  assert.deepEqual(queryOf(calls[1]), { limit: '1', cursor: 'cursor-2', insuranceType: 'CARGO_TRANSIT', status: 'SUBMITTED' });
  assert.equal((await insurance.getLead(LEAD_ID)).leadId, LEAD_ID);

  await assert.rejects(() => insurance.listLeads({ status: 'DONE' }), /'status' must be one of/);
  await assert.rejects(() => insurance.listLeads({ merchantOrderId: 'ORD-1' }), /Unknown insurance filter/);
  await assert.rejects(() => insurance.getLead(' '), /leadId is required/);
  assert.equal(calls.length, 3);
});

test('getPolicyReceipt and getPolicyCertificate return the PDF; a product without one is 412', async () => {
  const pdf = Buffer.from('%PDF-1.7 sample');
  const answers = [
    binaryResponse(200, pdf, 'application/pdf'),
    binaryResponse(200, pdf, 'application/pdf'),
    jsonResponse(412, { status: 'error', code: 'insurance.document.not_supported', message: 'Not supported.', statusCode: 412 }),
  ];
  const { insurance, calls } = makeClient(() => answers.shift());
  assert.ok((await insurance.getPolicyReceipt(POLICY_ID)).data.equals(pdf));
  assert.ok((await insurance.getPolicyCertificate(POLICY_ID)).data.equals(pdf));
  await assert.rejects(() => insurance.getPolicyCertificate(POLICY_ID), (error) => error instanceof ApiError
    && error.statusCode === 412 && error.code === 'insurance.document.not_supported');
  for (const call of calls) assert.match(call.headers.Accept, /^application\/pdf/);
});

test('createQuote takes the type objects of the new types', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(201, envelope({ insuranceType: 'PET_HEALTH', schemaVersion: 1, options: [] }, { statusCode: 201 })));
  for (const [insuranceType, field] of [['PET_HEALTH', 'pet'], ['FOREIGN_RESIDENT_HEALTH', 'residence'], ['ABROAD_STAY_HEALTH', 'abroadStay']]) {
    await insurance.createQuote({ insuranceType, currency: 'TRY', [field]: { startDate: '2026-01-02' } });
    assert.deepEqual(bodyOf(calls[calls.length - 1]), { insuranceType, currency: 'TRY', [field]: { startDate: '2026-01-02' } });
  }
});

test('query filters are sent the way the gateway parses them', async () => {
  const { insurance, calls, publicKey } = makeClient(() => jsonResponse(200, page([])));
  await insurance.listOrders({ limit: 50, cursor: 'opaque', paymentIntentId: PAYMENT_ID, merchantOrderId: 'ORD-1' });
  await insurance.listReconciliationOrders({
    from: new Date('2025-12-31T21:00:00.000Z'), to: '2026-02-01T00:00:00+03:00', connectionId: CONNECTION_ID,
    insuranceType: 'TICKET_CANCELLATION', currency: 'try', limit: 100,
  });
  await insurance.listReferenceValues(InsuranceReferenceKind.DEVICE_MODEL, { parentCode: 'BRAND-1', limit: 25 });
  assert.deepEqual(queryOf(calls[0]), { limit: '50', cursor: 'opaque', paymentIntentId: PAYMENT_ID, merchantOrderId: 'ORD-1' });
  assert.deepEqual(queryOf(calls[1]), {
    from: '2025-12-31T21:00:00.000Z', to: '2026-02-01T00:00:00+03:00', connectionId: CONNECTION_ID,
    insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', limit: '100',
  });
  assert.match(calls[1].url, /to=2026-02-01T00%3A00%3A00%2B03%3A00/, 'the "+" of a time-zone offset is percent-encoded');
  assert.equal(signatureGuardVerdict(calls[1], publicKey), 'OK');
  assert.deepEqual(queryOf(calls[2]), { parentCode: 'BRAND-1', limit: '25' });
});

test('invalid filters fail before anything is sent', async () => {
  const cases = [
    ['listOrders', [{ status: 'ACTIVE' }], /Unknown insurance filter/],
    ['listOrders', [{ limit: 0 }], /'limit'/],
    ['listOrders', [{ limit: 101 }], /'limit'/],
    ['listOrders', [{ cursor: 'x'.repeat(513) }], /'cursor'/],
    ['listProducts', [{ paymentIntentId: PAYMENT_ID }], /'currency'/],
    ['listProducts', [{ currency: 'TRY', paymentIntentId: PAYMENT_ID, merchantOrderId: 'ORD-1' }], /Unknown insurance filter/],
    ['getReconciliationSummary', [{ from: RECONCILIATION.from }], /'to'/],
    ['getReconciliationSummary', [{ ...RECONCILIATION, limit: 10 }], /Unknown insurance filter/],
    ['listReconciliationOrders', [{ ...RECONCILIATION, connectionId: 'conn_1' }], /'connectionId'/],
    ['exportReconciliation', [{ ...RECONCILIATION, from: new Date('invalid') }], /invalid Date/],
    ['listReferenceValues', ['NEIGHBOURHOOD'], /Reference kind/],
    ['listReferenceValues', ['CITY', { kind: 'CITY' }], /Unknown insurance filter/],
    ['searchProducts', [{ currency: 'TRY' }], /'context.items' is required/],
    ['searchProducts', [{ currency: 'TRY', context: { items: [ticketItem()] }, paymentIntentId: PAYMENT_ID }], /Unknown searchProducts request field/],
  ];
  const { insurance, calls } = makeClient(() => jsonResponse(200, page([])));
  for (const [method, args, message] of cases) {
    await assert.rejects(() => insurance[method](...args), (error) => error instanceof ConfigurationError && message.test(error.message), `${method} ${JSON.stringify(args)}`);
  }
  assert.equal(calls.length, 0);
});

test('products and quotes unwrap data; pages read the top-level pageInfo and iterate follows the cursor', async () => {
  const product = {
    insuranceType: 'TICKET_CANCELLATION', typeObject: 'tickets', schemaVersion: 1, basketItemIds: ['ticket-1'],
    title: { tr: 'Bilet iptal', en: 'Ticket cancellation' }, description: {}, fields: [{ name: 'tickets' }],
  };
  const second = orderJson({ orderId: `inso_${'e'.repeat(32)}` });
  const answers = [envelope({ products: [product] }), page([orderJson()], true, 'cursor-2'), page([second], true, null)];
  const { insurance, calls } = makeClient(() => jsonResponse(200, answers.shift()));
  assert.deepEqual(await insurance.listProducts({ currency: 'TRY', paymentIntentId: PAYMENT_ID }), { products: [product] });
  const ids = [];
  for await (const order of insurance.iterateOrders({ limit: 1 })) ids.push(order.orderId);
  assert.deepEqual(ids, [ORDER_ID, second.orderId], 'a page without a cursor is the last one');
  assert.deepEqual(queryOf(calls[2]), { limit: '1', cursor: 'cursor-2' });
});

test('listProducts without paymentIntentId asks for the types sold without a basket item', async () => {
  const product = {
    insuranceType: 'PERSONAL_ACCIDENT', typeObject: 'accident', schemaVersion: 1, basketItemIds: [],
    title: { tr: 'Ferdi kaza', en: 'Personal accident' }, description: {},
    fields: [{ name: 'accident', requiredBy: [{ underwriterCode: 'SAMPLE_CO', stage: 'QUOTE' }] }],
  };
  const { insurance, calls } = makeClient(() => jsonResponse(200, envelope({ products: [product] })));
  assert.deepEqual(await insurance.listProducts({ currency: 'try' }), { products: [product] });
  assert.deepEqual(queryOf(calls[0]), { currency: 'TRY' });
  assert.equal(target(calls[0]).split('?')[0], '/api/v1/insurance/products');
});

test('products carry prefill, the masked provided fields, quoteReady and the insuranceData issues as returned', async () => {
  // productOfferToJson (insurance-json.mapper.ts): the four fields of the API and the form; values synthetic.
  const product = {
    insuranceType: 'TICKET_CANCELLATION', typeObject: 'tickets', schemaVersion: 1, basketItemIds: ['ticket-1'],
    title: { tr: 'Bilet iptal', en: 'Ticket cancellation' }, description: {}, fields: [{ name: 'tickets' }],
    prefill: { tickets: [{ basketItemId: 'ticket-1', transportMode: 'TRAIN', departureAt: '2026-01-02T09:30:00+03:00' }] },
    providedFields: [
      { path: 'insured[0].identityNumber', masked: '***' },
      { path: 'tickets[0].pnr', masked: '***' },
    ],
    quoteReady: true,
    insuranceDataIssues: [{ basketItemId: 'ticket-2', field: 'device', reason: 'unknown_field' }],
  };
  const { insurance } = makeClient(() => jsonResponse(200, envelope({ products: [product] })));
  const { products } = await insurance.listProducts({ currency: 'TRY', paymentIntentId: PAYMENT_ID });
  assert.deepEqual(products, [product]);
  assert.equal(products[0].quoteReady, true);
  assert.deepEqual(products[0].providedFields.map(({ path }) => path), ['insured[0].identityNumber', 'tickets[0].pnr']);
});

test('createQuote with paymentIntentId alone sends no type fields; the recorded insurance data is merged by Lunixi', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(201, envelope({ insuranceType: 'TICKET_CANCELLATION', schemaVersion: 1, options: [quoteOption({ paymentIntentId: PAYMENT_ID })], excludedOptions: [] }, { statusCode: 201 })));

  const set = await insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'try', paymentIntentId: PAYMENT_ID });
  assert.equal(set.options[0].paymentIntentId, PAYMENT_ID);
  assert.equal(target(calls[0]), '/api/v1/insurance/quotes');
  assert.deepEqual(bodyOf(calls[0]), { insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID });

  // Partial body: only what is missing; the field sent wins over the recorded one.
  const tickets = [{ basketItemId: 'ticket-1', ticketNumber: 'SAMPLE-0002' }];
  await insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, tickets });
  assert.deepEqual(bodyOf(calls[1]), { insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', paymentIntentId: PAYMENT_ID, tickets });
});

test('context.items carry insuranceData unchanged to searchProducts and createQuote', async () => {
  const { insurance, calls } = makeClient((call) => (target(call) === '/api/v1/insurance/products'
    ? jsonResponse(200, envelope({ products: [] }))
    : jsonResponse(201, envelope({ insuranceType: 'TICKET_CANCELLATION', schemaVersion: 1, options: [quoteOption()], excludedOptions: [] }, { statusCode: 201 }))));
  // Synthetic values: a made-up passport number and a sample PNR.
  const insuranceData = {
    insured: [{ identityType: 'PASSPORT', identityNumber: 'P0000000', birthDate: '2000-01-01' }],
    tickets: { pnr: 'SAMPLE1' },
  };
  const item = new BasketItem({ ...ticketItem().toJSON(), insuranceData });

  await insurance.searchProducts({ currency: 'TRY', context: { items: [item] } });
  await insurance.createQuote({ insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', context: { items: [item] } });

  for (const call of calls) {
    assert.deepEqual(bodyOf(call).context.items[0].insuranceData, insuranceData);
    assert.equal(bodyOf(call).context.items[0].id, 'ticket-1');
  }
  assert.equal(bodyOf(calls[1]).tickets, undefined, 'the type object is not copied out of the item');
});

test('the reference kinds added for the new types are listed with their parent code', async () => {
  const { insurance, calls } = makeClient(() => jsonResponse(200, page([])));
  await insurance.listReferenceValues(InsuranceReferenceKind.PET_BREED, { parentCode: 'CAT' });
  await insurance.listReferenceValues(InsuranceReferenceKind.MEDICAL_PROCEDURE_COVER);
  assert.equal(target(calls[0]).split('?')[0], '/api/v1/insurance/reference/PET_BREED');
  assert.deepEqual(queryOf(calls[0]), { parentCode: 'CAT' });
  assert.equal(target(calls[1]).split('?')[0], '/api/v1/insurance/reference/MEDICAL_PROCEDURE_COVER');
  await assert.rejects(() => insurance.listReferenceValues('ADDRESS_STREET'), ConfigurationError, 'address kinds are not served by the list');
});

test('getPolicyDocument returns the PDF bytes and asks for a PDF', async () => {
  const pdf = Buffer.from('%PDF-1.7 sample');
  const { insurance, calls } = makeClient(() => binaryResponse(200, pdf, 'application/pdf'));
  const document = await insurance.getPolicyDocument(POLICY_ID);
  assert.equal(document.contentType, 'application/pdf');
  assert.ok(document.data.equals(pdf));
  assert.match(calls[0].headers.Accept, /^application\/pdf/);
});

test('a document error is the JSON envelope with its code', async () => {
  const { insurance } = makeClient(() => jsonResponse(503, { status: 'error', code: 'insurance.document.unavailable', message: 'Retry later.', statusCode: 503, details: { retryable: true } }));
  await assert.rejects(() => insurance.getPolicyDocument(POLICY_ID), (error) => error instanceof ApiError
    && error.statusCode === 503 && error.code === 'insurance.document.unavailable');
});

test('exportReconciliation reads the continuation and abort lines', async () => {
  const header = '﻿orderId,merchantOrderId\r\n';
  const files = [
    `${header}${ORDER_ID},ORD-1\r\n`,
    `${header}${ORDER_ID},ORD-1\r\n# truncated=true orderCap=20000 nextCursor=opaque-next\r\n`,
    `${header}${ORDER_ID},ORD-1\r\n# export-aborted=true\r\n`,
  ];
  const { insurance, calls } = makeClient(() => binaryResponse(200, Buffer.from(files.shift()), 'text/csv; charset=utf-8'));
  const complete = await insurance.exportReconciliation(RECONCILIATION);
  assert.deepEqual([complete.truncated, complete.nextCursor, complete.aborted], [false, null, false]);
  assert.equal(complete.contentType, 'text/csv; charset=utf-8');
  const cut = await insurance.exportReconciliation(RECONCILIATION);
  assert.deepEqual([cut.truncated, cut.nextCursor, cut.aborted], [true, 'opaque-next', false]);
  const aborted = await insurance.exportReconciliation({ ...RECONCILIATION, cursor: 'opaque-next' });
  assert.deepEqual([aborted.truncated, aborted.nextCursor, aborted.aborted], [false, null, true]);
  assert.equal(queryOf(calls[2]).cursor, 'opaque-next');
  assert.match(calls[0].headers.Accept, /^text\/csv/);
});

test('a conflict keeps its code and reason', async () => {
  const { insurance } = makeClient(() => jsonResponse(409, {
    status: 'error', code: 'insurance.order.premium_item_mismatch', message: 'Mismatch.', statusCode: 409, details: { reason: 'missing' },
  }));
  await assert.rejects(() => insurance.bindPayment(ORDER_ID, PAYMENT_ID), (error) => error instanceof ApiError
    && error.code === 'insurance.order.premium_item_mismatch' && error.response.details.reason === 'missing');
});

test('INSURANCE_FILTERS and INSURANCE_QUOTE_FIELDS list the gateway DTO fields', () => {
  assert.deepEqual(INSURANCE_FILTERS, {
    listProducts: ['currency', 'paymentIntentId', 'insuranceType'],
    listReferenceValues: ['parentCode', 'limit', 'cursor'],
    listOrders: ['limit', 'cursor', 'paymentIntentId', 'merchantOrderId'],
    getReconciliationSummary: ['from', 'to', 'connectionId', 'insuranceType', 'currency'],
    listReconciliationOrders: ['from', 'to', 'connectionId', 'insuranceType', 'currency', 'limit', 'cursor'],
    exportReconciliation: ['from', 'to', 'connectionId', 'insuranceType', 'currency', 'cursor'],
    listLeads: ['limit', 'cursor', 'insuranceType', 'status'],
  });
  const typeObjects = [
    'abroadStay', 'accident', 'device', 'event', 'instrument', 'pet', 'procedure', 'product', 'rental', 'residence', 'stay', 'tickets',
    'trip', 'vehicle',
  ];
  assert.deepEqual([...INSURANCE_QUOTE_FIELDS].sort(), [
    ...typeObjects, 'context', 'currency', 'insuranceType', 'insured', 'merchantOrderId', 'paymentIntentId', 'policyholder', 'schemaVersion',
  ].sort());
  // CreateInsuranceLeadDto: the type body (InsuranceQuotePayloadDto) + note, shipment, company.
  assert.deepEqual([...INSURANCE_LEAD_FIELDS].sort(), [
    ...typeObjects, 'company', 'insuranceType', 'insured', 'note', 'policyholder', 'schemaVersion', 'shipment',
  ].sort());
});

test('value sets match the gateway', () => {
  assert.deepEqual(Object.values(InsurancePremiumCollectedBy), ['MERCHANT', 'PROVIDER']);
  assert.deepEqual(Object.values(InsuranceQuoteStatus), ['REQUESTED', 'QUOTED', 'EXPIRED', 'REJECTED', 'ERROR']);
  assert.deepEqual([...Object.values(InsuranceOrderStatus)].sort(), [
    'ACTION_REQUIRED', 'ACTIVE', 'CANCELLED', 'CREATED', 'FAILED', 'PARTIALLY_ACTIVE', 'PROCESSING', 'REFUNDED',
  ]);
  assert.deepEqual(Object.values(InsuranceCollectionStatus), ['NOT_STARTED', 'PENDING', 'ACTION_REQUIRED', 'COLLECTED', 'FAILED', 'UNKNOWN']);
  assert.deepEqual(Object.values(InsurancePolicyStatus), [
    'NOT_REQUESTED', 'PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'UNKNOWN', 'CANCEL_PENDING', 'CANCELLED',
  ]);
  assert.deepEqual(Object.values(InsuranceRefundStatus), ['NONE', 'REQUIRED', 'PENDING', 'REFUNDED', 'FAILED']);
  assert.deepEqual(Object.values(InsuranceDocumentStatus), ['NOT_AVAILABLE', 'PENDING', 'AVAILABLE', 'FAILED']);
  assert.deepEqual(Object.values(InsurancePaymentMode), ['LUNIXI_PAYMENT', 'EXTERNAL_PAYMENT', 'NO_PAYMENT']);
  assert.deepEqual(Object.values(InsuranceOrderSurface), ['MERCHANT_API', 'CHECKOUT_FORM', 'PANEL']);
  assert.deepEqual(Object.values(InsuranceReferenceKind), [
    'COUNTRY', 'CITY', 'DISTRICT', 'DEVICE_BRAND', 'DEVICE_MODEL', 'VEHICLE_BRAND', 'VEHICLE_MODEL', 'VEHICLE_TYPE', 'PRODUCT_CATEGORY',
    'VEHICLE_USAGE', 'LIABILITY_LIMIT', 'OCCUPATION', 'PET_BREED', 'DWELLING_TYPE', 'DWELLING_FLOOR', 'BANK', 'BANK_BRANCH',
    'FINANCE_INSTITUTION', 'MEDICAL_PROCEDURE_COVER',
  ]);
  assert.deepEqual(Object.values(InsuranceLeadStatus), ['PENDING', 'SUBMITTED', 'UNKNOWN', 'FAILED']);
  assert.deepEqual([...INSURANCE_EVENT_TYPES], [
    'insurance.policy.issued', 'insurance.policy.failed', 'insurance.refund.required',
    'insurance.policy.document_ready', 'insurance.policy.cancelled', 'insurance.refund.completed',
    'insurance.lead.submitted',
  ]);
});

test('an insurance webhook verifies with WebhookVerifier', () => {
  const secret = 'whsec_test_insurance';
  const eventId = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
  const timestamp = new Date().toISOString();
  const data = {
    eventId, eventType: 'insurance.policy.issued', merchantId: 'org_1', insuranceOrderId: ORDER_ID, paymentIntentId: PAYMENT_ID,
    merchantOrderId: 'ORD-1', insuranceType: 'TICKET_CANCELLATION', premiumCollectedBy: 'MERCHANT',
    provider: { code: 'SAMPLE', name: 'Sample', logoUrl: null, connectionId: CONNECTION_ID }, status: 'ACTIVE',
    collectionStatus: 'COLLECTED', policyStatus: 'ISSUED', refundStatus: 'NONE', documentStatus: 'AVAILABLE', premiumAmount: 4900,
    currency: 'TRY', policies: [{
      policyId: POLICY_ID, basketItemId: 'ticket-1', policyNumber: 'P-1', policyStatus: 'ISSUED', documentStatus: 'AVAILABLE',
      documentUrl: `${BASE_URL}/api/v1/insurance/policies/${POLICY_ID}/document`,
    }],
    createdAt: timestamp,
  };
  const body = JSON.stringify({
    id: eventId, type: 'insurance.policy.issued', sourceService: 'insurance-service', organizationId: 'org_1',
    productCode: 'INSURANCE_SERVICE', environment: 'TEST', eventVersion: 1, schemaVersion: 'v1', createdAt: timestamp, data,
  });
  const signature = crypto.createHmac('sha256', secret).update(`${eventId}.${timestamp}.${body}`).digest('hex');
  const event = new WebhookVerifier(secret).verify(body, {
    'x-lunixi-event-id': eventId,
    'x-lunixi-event-type': 'insurance.policy.issued',
    'x-lunixi-signature': `v2=${signature}`,
    'x-lunixi-signature-timestamp': timestamp,
  });
  assert.equal(event.type, InsuranceEvents.POLICY_ISSUED);
  assert.ok(event.type.startsWith(INSURANCE_EVENT_PATTERN.slice(0, -1)));
  assert.deepEqual(event.data, data);
});

test('a lead webhook verifies with WebhookVerifier and carries only the lead summary', () => {
  const secret = 'whsec_test_insurance';
  const eventId = '8d7c6b5a-4f3e-4d2c-9b1a-0f9e8d7c6b5a';
  const timestamp = new Date().toISOString();
  // insurance-webhook.policy.ts: the lead payload's two allow-lists (top level + `lead`).
  const data = {
    eventId, eventType: 'insurance.lead.submitted', merchantId: 'org_1',
    lead: { leadId: LEAD_ID, insuranceType: 'CARGO_TRANSIT', schemaVersion: 1, status: 'SUBMITTED', submittedAt: timestamp, createdAt: timestamp },
    createdAt: timestamp,
  };
  const body = JSON.stringify({
    id: eventId, type: 'insurance.lead.submitted', sourceService: 'insurance-service', organizationId: 'org_1',
    productCode: 'INSURANCE_SERVICE', environment: 'TEST', eventVersion: 1, schemaVersion: 'v1', createdAt: timestamp, data,
  });
  const signature = crypto.createHmac('sha256', secret).update(`${eventId}.${timestamp}.${body}`).digest('hex');
  const event = new WebhookVerifier(secret).verify(body, {
    'x-lunixi-event-id': eventId,
    'x-lunixi-event-type': 'insurance.lead.submitted',
    'x-lunixi-signature': `v2=${signature}`,
    'x-lunixi-signature-timestamp': timestamp,
  });
  assert.equal(event.type, InsuranceEvents.LEAD_SUBMITTED);
  assert.deepEqual(event.data, data);
});
