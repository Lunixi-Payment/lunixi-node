'use strict';

/*
 * Contract source: nest-payment-gateway apps/api-gateway/src/sanction/sanction.controller.ts
 * (routes, permissions), sanction.service.ts (response shapes), libs/proto/sanction/sanction.proto
 * (request fields) and libs/common/src/interceptors/gateway-format.interceptor.ts (envelope).
 * Names in the fixtures are fictional.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  SanctionClient,
  SanctionRiskDomain,
  SanctionScreenMode,
  SanctionCoverageStatus,
  SANCTION_ROUTES,
  isClearScreening,
  ConfigurationError,
  ApiError,
  ServiceUnavailableError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';

function jsonResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => JSON.stringify(body) };
}

function envelope(data, extra = {}) {
  return { status: 'success', code: 'sanction.screen_name.completed', data, statusCode: 200, requestId: 'req_http_1', ...extra };
}

function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    const call = { url: String(url), ...options };
    if (call.url === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at_test_1', expires_in: 1800 });
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_test_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 0 });
  return { sanction: client.sanction, calls };
}

const nameResult = (overrides = {}) => ({
  latencyMs: 128,
  screeningRequestId: 'scr_01',
  publicationId: 'pub_01',
  publicationRevision: 34,
  coverageStatus: 'COMPLETE',
  evidenceRef: 'ev_01',
  screenedRiskDomains: ['sanctions', 'pep'],
  uncoveredRiskDomains: [],
  matches: [],
  datasetFreshnessJson: '{}',
  ...overrides,
});

test('client.sanction is a SanctionClient', () => {
  const { sanction } = makeClient(() => jsonResponse(200, envelope({})));
  assert.ok(sanction instanceof SanctionClient);
});

test('the route table covers only API-key routes and leaves the panel report out', () => {
  const paths = Object.values(SANCTION_ROUTES).map((route) => `${route.method} ${route.path}`);
  assert.equal(paths.length, 19);
  assert.ok(!paths.some((entry) => entry.includes('/report')), 'the PDF report is panel-session only');
  assert.ok(!paths.some((entry) => entry.startsWith('POST /api/v1/sanction/blacklist')), 'adding an entry needs sanction:add_list_entry');
  assert.ok(!paths.some((entry) => entry.includes('/analyst/')), 'analyst routes are not merchant integration routes');
  assert.ok(!paths.some((entry) => entry.endsWith('/sync')), 'source syncs are operator routes');
  for (const route of Object.values(SANCTION_ROUTES)) assert.match(route.path, /^\/api\/v1\/sanction\//);
});

test('screenName sends the documented body bearer-only and returns data with screeningRequestId', async () => {
  const { sanction, calls } = makeClient(() => jsonResponse(200, envelope(nameResult({
    matches: [{ hitId: 'h1', entityId: 'e1', matchedName: 'Ayla Kurgu', score: 0.91, hitType: 'probable', lists: [{ datasetCode: 'OFAC', entityIds: ['e1'] }] }],
  }))));

  const result = await sanction.screenName({
    name: 'Ayla Kurgu',
    subjectType: 'person',
    country: 'TR',
    riskDomains: [SanctionRiskDomain.SANCTIONS, SanctionRiskDomain.PEP],
    mode: SanctionScreenMode.SANCTIONS_PEP,
    threshold: 0.85,
    identifiers: [{ type: 'passport', value: 'X0000000' }],
    customerReference: 'cust_1',
  });

  assert.equal(result.screeningRequestId, 'scr_01');
  assert.equal(result.matches[0].lists[0].datasetCode, 'OFAC');
  assert.equal(isClearScreening(result), false);
  const call = calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE_URL}/api/v1/sanction/screening/name`);
  assert.equal(call.headers.Authorization, 'Bearer at_test_1');
  assert.equal(call.headers['X-Signature'], undefined, 'sanction routes are bearer-only');
  assert.deepEqual(JSON.parse(call.body).riskDomains, ['sanctions', 'pep']);
});

test('isClearScreening: no match is clear only with COMPLETE coverage', () => {
  assert.equal(isClearScreening(nameResult()), true);
  assert.equal(isClearScreening(nameResult({ coverageStatus: SanctionCoverageStatus.PARTIAL, uncoveredRiskDomains: ['vessel'] })), false);
  assert.equal(isClearScreening(nameResult({ coverageStatus: SanctionCoverageStatus.DEGRADED })), false);
  assert.equal(isClearScreening(nameResult({ coverageStatus: null })), false, 'a replay without coverage is not clear');
  assert.equal(isClearScreening({ isSanctioned: true, coverageStatus: 'COMPLETE', hits: [], publicationHits: [] }), false);
  assert.equal(isClearScreening({ coverageStatus: 'COMPLETE', hits: [], publicationHits: [{ hitId: 'w1' }] }), false);
  assert.equal(isClearScreening({ matched: false, hits: [], coverageStatus: 'PARTIAL', uncoveredSources: [{ datasetCode: 'TR_PUBLIC_PROCUREMENT_BAN' }] }), false);
  assert.equal(isClearScreening({ decision: 'allow', caseRequired: true, coverageStatus: 'COMPLETE' }), false);
  assert.equal(isClearScreening({ isSanctioned: false, isBlacklisted: false, hits: [] }), true, 'account screening has no coverage');
  assert.equal(isClearScreening(null), false);
});

test('a screening that cannot run throws, never an empty result', async () => {
  const { sanction } = makeClient(() => jsonResponse(503, { status: 'failure', code: 'sanction.screen_name.failed', message: 'No list publication.', statusCode: 503 }));
  await assert.rejects(sanction.screenName({ name: 'Ayla Kurgu' }), (error) => error instanceof ServiceUnavailableError && error.code === 'sanction.screen_name.failed');

  const odd = makeClient(() => jsonResponse(200, { status: 'failure', code: 'sanction.wallet.failed', data: { hits: [], publicationHits: [] } }));
  await assert.rejects(odd.sanction.screenWallet({ walletAddress: '0x0000000000000000000000000000000000000001' }), (error) => error instanceof ApiError && error.code === 'sanction.wallet.failed');
});

test('bodies are checked before sending', async () => {
  const { sanction, calls } = makeClient(() => jsonResponse(200, envelope({})));
  await assert.rejects(sanction.screenName({}), ConfigurationError);
  await assert.rejects(sanction.screenName({ name: 'Ayla Kurgu', riskDomain: ['pep'] }), /does not accept riskDomain/);
  await assert.rejects(sanction.screenName({ name: 'Ayla Kurgu', riskDomains: ['pep', 'crypto'] }), /riskDomains must be one of/);
  await assert.rejects(sanction.screenName({ name: 'Ayla Kurgu', mode: 'everything' }), /mode must be one of/);
  await assert.rejects(sanction.screenName({ name: 'Ayla Kurgu', identifiers: [{ type: 'passport' }] }), /identifiers\[0\] requires value/);
  await assert.rejects(sanction.screenWallet({ walletAddress: '0x01', mode: 'full' }), /mode must be one of/);
  await assert.rejects(sanction.screenPublicProcurementBan({ onlyActive: true }), /at least one of entityName, tckn, vkn/);
  await assert.rejects(sanction.screenTransaction({ amount: 100, currency: 'TRY', parties: [] }), /at least one of parties, accounts/);
  await assert.rejects(sanction.screenTransaction({ parties: [{ role: 'payer', name: 'Ayla Kurgu', iban: 'x' }] }), /parties\[0\] does not accept iban/);
  assert.equal(calls.length, 0, 'nothing reached the gateway');
});

test('wallet screening keeps publication hits apart from your own list hits', async () => {
  const { sanction, calls } = makeClient(() => jsonResponse(200, envelope({
    address: '0x0000000000000000000000000000000000000001', chain: 'ethereum', isSanctioned: true, riskScore: 100,
    publicationId: 'pub_01', publicationRevision: 34, coverageStatus: 'COMPLETE', evidenceRef: 'ev_w',
    publicationHits: [{ hitId: 'w1', entityName: 'Örnek Holding', riskCategory: 'sanctions', listedChains: ['ETH'], caseRule: 'EVM_HEX', lists: [] }],
    hits: [],
  }, { code: 'sanction.wallet.completed' })));

  const result = await sanction.screenWallet({ walletAddress: '0x0000000000000000000000000000000000000001', chain: 'ethereum', mode: 'wallet_sanctions' });
  assert.equal(result.publicationHits[0].caseRule, 'EVM_HEX');
  assert.deepEqual(result.hits, []);
  assert.equal(isClearScreening(result), false);
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/sanction/screening/wallet`);
});

test('procurement ban screening is PARTIAL while KİK is uncovered', async () => {
  const { sanction, calls } = makeClient(() => jsonResponse(200, envelope({
    matched: false, riskScore: 0, hits: [], coverageStatus: 'PARTIAL', screenedRiskDomains: ['debarment'],
    searchedLists: [{ datasetCode: 'WB_DEBARRED', displayName: 'World Bank', datasetVersionId: 'v1' }],
    uncoveredSources: [{ datasetCode: 'TR_PUBLIC_PROCUREMENT_BAN', displayName: 'KİK', reason: 'NOT_PUBLISHED' }],
  }, { code: 'sanction.public_procurement.completed' })));

  const result = await sanction.screenPublicProcurementBan({ vkn: '0000000000', onlyActive: true });
  assert.equal(result.uncoveredSources[0].datasetCode, 'TR_PUBLIC_PROCUREMENT_BAN');
  assert.equal(isClearScreening(result), false);
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/sanction/intelligence/public-procurement-ban`);
});

test('lists page with nextCursor or pageInfo, and an empty cursor ends the iteration', async () => {
  const answers = [
    envelope({ items: [{ runId: 'r1' }], nextCursor: 'c2', runsToday: 2 }),
    envelope({ items: [{ runId: 'r2' }], nextCursor: '' }),
  ];
  const { sanction, calls } = makeClient(() => jsonResponse(200, answers.shift()));
  const runs = [];
  for await (const run of sanction.iterateScreeningHistory({ limit: 1 })) runs.push(run.runId);
  assert.deepEqual(runs, ['r1', 'r2']);
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/sanction/screening/history?limit=1`);
  assert.equal(calls[1].url, `${BASE_URL}/api/v1/sanction/screening/history?limit=1&cursor=c2`);

  const deny = makeClient(() => jsonResponse(200, envelope({ items: [{ type: 'person' }], totalEntries: 7 }, { pageInfo: { hasMore: true, nextCursor: 'b2', totalCount: 7 } })));
  const page = await deny.sanction.listBlacklistEntries({ limit: 1 });
  assert.deepEqual([page.nextCursor, page.hasMore, page.totalCount], ['b2', true, 7]);

  await assert.rejects(sanction.listMonitoringAlerts({ severity: 'high' }), /does not accept the filter/);
});

test('monitoring and intelligence routes', async () => {
  const { sanction, calls } = makeClient(() => jsonResponse(200, envelope({ monitoredEntityId: 'me_1', items: [] })));

  const registered = await sanction.registerMonitoring({ externalCustomerId: 'cust_1', subjectType: 'person', profile: { name: 'Ayla Kurgu' }, riskDomainScope: ['sanctions'] });
  assert.equal(registered.monitoredEntityId, 'me_1');
  assert.deepEqual(JSON.parse(calls[0].body), { externalCustomerId: 'cust_1', subjectType: 'person', riskDomainScope: ['sanctions'], profileJson: '{"name":"Ayla Kurgu"}' });

  await sanction.listMonitoredEntities({ activeOnly: false, includeTotal: true });
  assert.equal(calls[1].url, `${BASE_URL}/api/v1/sanction/monitoring/entities?activeOnly=false&includeTotal=true`);

  await sanction.getEntityProfile('ent/1', { screeningRequestId: 'scr_01' });
  assert.equal(calls[2].url, `${BASE_URL}/api/v1/sanction/intelligence/entity-profiles/ent%2F1?screeningRequestId=scr_01`);

  await sanction.getIndirectExposure('e1', { maxDepth: 3, entityIds: ['e1', 'e2'] });
  assert.equal(calls[3].url, `${BASE_URL}/api/v1/sanction/intelligence/indirect-exposure/e1?maxDepth=3&entityIds=e1%2Ce2`);

  await sanction.searchEntities({ q: 'Örnek', limit: 5 });
  assert.equal(calls[4].method, 'GET');
  assert.equal(calls[4].body, null);

  await assert.rejects(sanction.getEntityGraph(' '), /entityId is required/);
});
