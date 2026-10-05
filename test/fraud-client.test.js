'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  FraudEvents,
  FRAUD_EVENT_TYPES,
  FraudDecisionValue,
  fraud,
  ConfigurationError,
  ValidationError,
  RateLimitError,
  ServiceUnavailableError,
} = require('../src');

function jsonResponse(status, body, headers = {}) {
  const map = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: map,
    text: async () => JSON.stringify(body),
  };
}

function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    return responder(String(url), options);
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

test('evaluate posts to the decision endpoint and unwraps the envelope', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, {
    success: true,
    data: { decision: 'force_3d', score: 72.5, traceId: 'tr_1', reasonCodes: ['high_amount_non_3d'] },
  }));

  const decision = await client.fraud.evaluate({
    channel: fraud.CHANNELS.STANDALONE_API,
    surface: fraud.SURFACES.TRANSACTION,
    stage: fraud.STAGES.PRE_AUTHORIZATION,
    operationKind: fraud.OPERATION_KINDS.CARD_SALE,
    authModeRequested: fraud.AUTH_MODES.TWO_D,
    transactionRef: 'order-2026-0001',
    subjectId: 'order-2026-0001',
    payment: { amount: 25000, currency: 'TRY' },
  });

  assert.equal(decision.decision, FraudDecisionValue.FORCE_3D);
  assert.equal(decision.traceId, 'tr_1');

  const call = calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://gw.example.com/api/v1/fraud/decisions/evaluate');
  const body = JSON.parse(call.body);
  assert.equal(body.channel, 'standalone_api');
  assert.equal(body.transactionRef, 'order-2026-0001');
});

test('evaluate rejects unknown fields locally instead of sending a 400-bound body', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, { success: true, data: {} }));

  await assert.rejects(
    () => client.fraud.evaluate({ transactionRef: 'o1', flow: { id: 'f1' } }),
    (error) => error instanceof ConfigurationError && /flow/.test(error.message),
  );

  // Nothing but the token call went out.
  assert.ok(calls.every((call) => String(call.url).endsWith('/api/v1/auth/token')));
});

test('tenantId is not an accepted evaluate field — the token decides the tenant', async () => {
  const { client } = makeClient(() => jsonResponse(200, { success: true, data: {} }));

  await assert.rejects(
    () => client.fraud.evaluate({ transactionRef: 'o1', tenantId: 'someone-else' }),
    (error) => error instanceof ConfigurationError && /tenantId/.test(error.message),
  );
});

test('evaluate enforces the 180-character bound on transactionRef', async () => {
  const { client } = makeClient(() => jsonResponse(200, { success: true, data: {} }));

  await assert.rejects(
    () => client.fraud.evaluate({ transactionRef: 'x'.repeat(181) }),
    (error) => error instanceof ConfigurationError && /180/.test(error.message),
  );
});

test('event ingest signs each request (step-up), single and batch', async () => {
  const { client, calls } = makeClient(() => jsonResponse(202, { success: true, data: { accepted: 1 } }));

  await client.fraud.events.record({
    eventId: 'evt-1',
    subjectType: 'bank_transfer',
    eventType: 'transfer_completed',
    occurredAt: '2026-09-21T00:00:00.000Z',
  });
  let call = calls.at(-1);
  assert.equal(call.url, 'https://gw.example.com/api/v1/fraud/events/transactions');
  assert.ok(call.headers['X-Signature'], 'event ingest must carry a per-request signature');
  assert.ok(call.headers.Digest);

  await client.fraud.events.recordBatch([{
    eventId: 'evt-2',
    subjectType: 'bank_transfer',
    eventType: 'transfer_completed',
    occurredAt: '2026-09-21T00:00:00.000Z',
  }]);
  call = calls.at(-1);
  assert.equal(call.url, 'https://gw.example.com/api/v1/fraud/events/transactions/batch');
  assert.ok(call.headers['X-Signature']);
  assert.ok(Array.isArray(JSON.parse(call.body)));
});

test('event ingest refuses an empty batch', async () => {
  const { client } = makeClient(() => jsonResponse(202, { success: true, data: {} }));
  await assert.rejects(() => client.fraud.events.recordBatch([]), ConfigurationError);
});

test('decision log listing sends the cursor and reads pageInfo beside data', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, {
    success: true,
    data: [{ traceId: 'tr_1', decision: 'allow' }],
    pageInfo: { hasMore: true, nextCursor: 'cur_abc', totalCount: null },
  }));

  const page = await client.fraud.decisions.list({ limit: 1, cursor: 'cur_prev' });

  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'cur_abc');
  assert.equal(page.totalCount, null);
  assert.match(String(calls.at(-1).url), /cursor=cur_prev/);
  assert.match(String(calls.at(-1).url), /limit=1/);
});

test('iterate follows cursors until the last page', async () => {
  let page = 0;
  const { client } = makeClient(() => {
    page += 1;
    return page === 1
      ? jsonResponse(200, {
        success: true,
        data: [{ traceId: 'tr_1' }],
        pageInfo: { hasMore: true, nextCursor: 'cur_2', totalCount: null },
      })
      : jsonResponse(200, {
        success: true,
        data: [{ traceId: 'tr_2' }],
        pageInfo: { hasMore: false, nextCursor: null, totalCount: 2 },
      });
  });

  const seen = [];
  for await (const row of client.fraud.decisions.iterate({ limit: 1 })) seen.push(row.traceId);

  assert.deepEqual(seen, ['tr_1', 'tr_2']);
});

test('400 surfaces as ValidationError carrying the gateway code', async () => {
  const { client } = makeClient(() => jsonResponse(400, {
    message: 'channel yalnız şu değerlerden biri olabilir: merchant_form, standalone_api',
    code: 'FRAUD_CHANNEL_NOT_DECLARABLE',
  }));

  await assert.rejects(
    () => client.fraud.evaluate({ channel: 'lunixi_checkout' }),
    (error) => error instanceof ValidationError
      && error.statusCode === 400
      && error.code === 'FRAUD_CHANNEL_NOT_DECLARABLE',
  );
});

test('429 surfaces as RateLimitError with Retry-After and quota headers', async () => {
  const { client } = makeClient(() => jsonResponse(429, { message: 'Quota exceeded', code: 'fraud.quota.exceeded' }, {
    'retry-after': '30',
    'x-ratelimit-limit': '100',
    'x-ratelimit-remaining': '0',
    'x-quota-limit': '10000',
    'x-quota-remaining': '0',
  }));

  await assert.rejects(
    () => client.fraud.evaluate({ transactionRef: 'o1' }),
    (error) => error instanceof RateLimitError
      && error.retryAfter === 30
      && error.quota.rateLimit === 100
      && error.quota.dailyRemaining === 0,
  );
});

test('503 surfaces as ServiceUnavailableError; absent quota headers stay null, never guessed', async () => {
  const { client } = makeClient(() => jsonResponse(503, { message: 'Quota backend unavailable' }, {
    'retry-after': '5',
  }));

  await assert.rejects(
    () => client.fraud.evaluate({ transactionRef: 'o1' }),
    (error) => error instanceof ServiceUnavailableError
      && error.retryAfter === 5
      && error.quota === null,
  );
});

test('fraud webhook event types are the six platform catalogue keys, no internal topics', () => {
  assert.deepEqual(FRAUD_EVENT_TYPES, [
    'fraud.flow.async_completed',
    'fraud.flow.action_triggered',
    'fraud.quota.threshold_reached',
    'fraud.alert.triggered',
    'fraud.service.degraded',
    'fraud.service.recovered',
    'fraud.report.ready',
  ]);
  assert.equal(FraudEvents.FLOW_ASYNC_COMPLETED, 'fraud.flow.async_completed');
  for (const key of FRAUD_EVENT_TYPES) {
    assert.ok(!key.endsWith('.v1'), `${key} looks like an internal topic, not a webhook type`);
  }
});

test('only standalone is a declarable integration mode', () => {
  assert.equal(fraud.INTEGRATION_MODE_STANDALONE, 'standalone');
  assert.deepEqual(fraud.CHANNEL_VALUES, ['merchant_form', 'standalone_api']);
});
