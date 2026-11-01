'use strict';

/*
 * Shared parity fixture (test/fixtures/physical-pos-parity.json). The PHP, Java
 * and Python SDKs read byte-identical copies; the expected values were computed
 * from the gateway rules (card-data key tokens, the body/query field-path guard
 * and the PAN value scan). A rule or list that drifts from the gateway turns
 * one of these tests red in every SDK.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LunixiClient,
  PHYSICAL_POS_REQUEST_FIELDS,
  PHYSICAL_POS_FILTERS,
  PHYSICAL_POS_NOT_STARTED_CODES,
  PhysicalPosCardDataRejectedError,
  ConfigurationError,
} = require('../src');
const {
  CARD_DATA_KEY_RULE,
  isCardDataKey,
  findCardDataField,
  containsPanLikeValue,
  pathId,
} = require('../src/physical-pos/physical-pos-request');
const { PAYMENT_TARGET_FIELDS, SALE_ITEM_FIELDS, REFUND_ITEM_FIELDS } = require('../src/physical-pos/physical-pos-values');
const { originalOf } = require('../src/physical-pos/physical-pos-webhook');
const { PHYSICAL_POS_EVENT_TYPES } = require('../src');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'physical-pos-parity.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';

function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), ...init };
    if (call.url === BASE_URL + TOKEN_PATH) {
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ access_token: 'at', expires_in: 1800 }) };
    }
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_live_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 0 });
  return { pos: client.physicalPos, calls };
}

const accepted = () => ({
  ok: true,
  status: 202,
  headers: new Map(),
  text: async () => JSON.stringify({ status: 'success', statusCode: 202, data: { payment: { paymentId: 'p1' }, replayed: false } }),
});

const sale = () => ({
  operation: 'SALE', target: { deviceId: 'd1' }, amountMinor: "1000", currency: 'TRY',
});

const sorted = (list) => [...list].sort();

test('the monorepo copies of the parity fixture are byte-identical', (t) => {
  const root = path.resolve(__dirname, '..', '..');
  const copies = [
    'php/tests/PhysicalPos/fixtures/physical-pos-parity.json',
    'java/src/test/resources/physical-pos-parity.json',
    'python/tests/fixtures/physical-pos-parity.json',
  ].map((relative) => path.join(root, relative)).filter((file) => fs.existsSync(file));
  if (copies.length === 0) {
    t.skip('outside the monorepo');
    return;
  }
  const own = fs.readFileSync(FIXTURE_PATH);
  for (const file of copies) assert.ok(own.equals(fs.readFileSync(file)), `${file} differs`);
});

test('card-data term lists equal the gateway rule', () => {
  for (const name of ['numberTerms', 'secretTerms', 'suffixTerms', 'wholeKeyTerms', 'maskTokens']) {
    assert.deepEqual(sorted(CARD_DATA_KEY_RULE[name]), sorted(fixture.cardDataKeyRule[name]), name);
  }
});

test('cardDataKeyCases', () => {
  assert.ok(fixture.cardDataKeyCases.length > 50);
  for (const { key, cardData } of fixture.cardDataKeyCases) assert.equal(isCardDataKey(key), cardData, key);
});

test('cardDataPathCases', () => {
  for (const { body, field } of fixture.cardDataPathCases) assert.equal(findCardDataField(body), field, JSON.stringify(body));
});

test('panValueCases', () => {
  for (const { value, mode, pan } of fixture.panValueCases) assert.equal(containsPanLikeValue(value, mode), pan, `${mode} ${value}`);
});

test('idempotencyKeyCases: valid keys are sent exactly as given; invalid keys are refused before sending', async () => {
  for (const { key, valid } of fixture.idempotencyKeyCases) {
    const { pos, calls } = makeClient(accepted);
    if (valid) {
      const result = await pos.createPayment(sale(), key);
      assert.equal(calls[0].headers['Idempotency-Key'], key);
      assert.equal(result.idempotencyKey, key);
    } else {
      await assert.rejects(pos.createPayment(sale(), key), ConfigurationError, JSON.stringify(key));
      await assert.rejects(pos.cancelPayment('p1', key), ConfigurationError, JSON.stringify(key));
      assert.equal(calls.length, 0);
    }
  }
});

test('forbiddenFields are refused on createPayment before sending', async () => {
  const { pos, calls } = makeClient(accepted);
  for (const field of fixture.forbiddenFields) {
    await assert.rejects(pos.createPayment({ ...sale(), [field]: 'x' }, 'parity-key-0001'), (error) => {
      assert.ok(error instanceof ConfigurationError || error instanceof PhysicalPosCardDataRejectedError, field);
      if (isCardDataKey(field)) assert.ok(error instanceof PhysicalPosCardDataRejectedError, field);
      return true;
    });
  }
  assert.equal(calls.length, 0);
});

test('request field lists equal the gateway DTOs', () => {
  const lists = {
    ...Object.fromEntries(Object.entries(PHYSICAL_POS_REQUEST_FIELDS).map(([name, fields]) => [name, Object.keys(fields)])),
    paymentTarget: PAYMENT_TARGET_FIELDS,
    saleItem: SALE_ITEM_FIELDS,
    refundItem: REFUND_ITEM_FIELDS,
  };
  assert.deepEqual(sorted(Object.keys(lists)), sorted(Object.keys(fixture.requestFields)));
  for (const [name, fields] of Object.entries(fixture.requestFields)) assert.deepEqual(sorted(lists[name]), sorted(fields), name);
});

test('filter lists equal the gateway query DTOs', () => {
  assert.deepEqual(sorted(Object.keys(PHYSICAL_POS_FILTERS)), sorted(Object.keys(fixture.filters)));
  for (const [route, filters] of Object.entries(fixture.filters)) assert.deepEqual(sorted(PHYSICAL_POS_FILTERS[route]), sorted(filters), route);
});

test('eventTypes', () => {
  assert.deepEqual([...PHYSICAL_POS_EVENT_TYPES], fixture.eventTypes);
});

test('webhookOriginalCases', () => {
  assert.ok(fixture.webhookOriginalCases.length > 5);
  for (const { name, data, original } of fixture.webhookOriginalCases) assert.deepEqual(originalOf(data), original, name);
});

test('notStartedCodes', () => {
  assert.deepEqual(sorted(PHYSICAL_POS_NOT_STARTED_CODES), sorted(fixture.notStartedCodes));
});

test('pathIdCases', () => {
  for (const { id, valid, encoded } of fixture.pathIdCases) {
    if (valid) assert.equal(pathId(id, 'id'), encoded ?? encodeURIComponent(id), id);
    else assert.throws(() => pathId(id, 'id'), ConfigurationError, JSON.stringify(id));
  }
});
