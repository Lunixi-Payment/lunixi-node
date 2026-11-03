'use strict';

/*
 * Contract source: nest-payment-gateway apps/api-gateway/src/physical-pos/
 * (stores/*, terminals/*, devices/*, settlements/*, catalog/*, overview/* — API controllers, DTOs, mappers).
 * Ids and values below are synthetic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  PhysicalPosManagementClient,
  PhysicalPosCardDataRejectedError,
  PhysicalPosOutcomeUnknownError,
  ConfigurationError,
  ApiError,
} = require('../src');

const BASE_URL = 'https://gw.example.com';
const TOKEN_PATH = '/api/v1/auth/token';
const STORE_ID = '11111111-1111-4111-8111-111111111111';
const REGISTER_ID = '22222222-2222-4222-8222-222222222222';
const TERMINAL_ID = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';
const DEVICE_ID = '55555555-5555-4555-8555-555555555555';
const PROVIDER_ROW_ID = '66666666-6666-4666-8666-666666666666';
const VENDOR_ACCOUNT_ID = '77777777-7777-4777-8777-777777777777';
const KEY = 'pos-mgmt-key-0001';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => JSON.stringify(body) };
}

function envelope(data, extra = {}) {
  return { status: 'success', code: 'SUCCESS', data, statusCode: 200, requestId: 'req_1', ...extra };
}

function makeClient(responder) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), ...init };
    if (call.url === BASE_URL + TOKEN_PATH) return jsonResponse(200, { access_token: 'at_test_1', expires_in: 1800 });
    calls.push(call);
    return responder(call);
  };
  const client = new LunixiClient({ baseUrl: BASE_URL, keyId: 'mk_live_sk_kid_1', privateKey: keys.privateKey, fetch, maxRetries: 0 });
  return { mgmt: client.physicalPosManagement, calls };
}

const target = (call) => call.url.slice(BASE_URL.length).split('?')[0];
const queryOf = (call) => Object.fromEntries(new URL(call.url).searchParams.entries());
const bodyOf = (call) => (call.body === null || call.body === undefined ? null : JSON.parse(call.body));

const store = (overrides = {}) => ({
  id: STORE_ID, code: 'IST-01', name: 'Istanbul 1', city: null, district: null, addressLine: null, timezone: 'Europe/Istanbul',
  storeStatus: 'ACTIVE', externalRef: null, rowVersion: 1, createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z',
  ...overrides,
});

const device = (overrides = {}) => ({ id: DEVICE_ID, serialNumber: 'PAV00012345', lifecycleStatus: 'ACTIVE', rowVersion: 3, ...overrides });

test('client is exposed; activation codes are not issued with an API key (K-94)', () => {
  const { mgmt } = makeClient(() => jsonResponse(200, envelope({})));
  assert.ok(mgmt instanceof PhysicalPosManagementClient);
  assert.equal(mgmt.issueActivationCode, undefined);
  for (const name of [
    'listDeviceKeys', 'iterateDeviceKeys', 'revokeDeviceKey', 'revertDeviceEnrollment', 'revokeActivationCode',
    'listTerminalProviders', 'iterateTerminalProviders', 'addTerminalProvider', 'updateTerminalProvider',
    'getAccountSettlementPolicy', 'setAccountSettlementPolicy', 'clearAccountSettlementPolicy',
    'getStoreSettlementPolicy', 'setStoreSettlementPolicy', 'clearStoreSettlementPolicy',
    'getDeviceSettlementPolicy', 'setDeviceSettlementPolicy', 'clearDeviceSettlementPolicy', 'getEffectiveSettlementPolicy',
  ]) {
    assert.equal(typeof mgmt[name], 'function', name);
  }
});

test('overview and catalog reads unwrap data; device model filters are checked', async () => {
  const { mgmt, calls } = makeClient((call) => {
    const path = target(call);
    if (path.endsWith('/overview')) return jsonResponse(200, envelope({ overview: { stores: { active: 1, archived: 0 }, transactions: null } }));
    return jsonResponse(200, envelope([{ code: 'PAVO' }]));
  });
  const overview = await mgmt.getOverview();
  assert.equal(overview.stores.active, 1);
  assert.deepEqual(await mgmt.listVendors(), [{ code: 'PAVO' }]);
  await mgmt.listDeviceModels({ vendorCode: 'PAVO', deviceType: 'PHYSICAL', status: 'ACTIVE' });
  await mgmt.listAcquirers();
  assert.deepEqual(calls.map(target), [
    '/api/v1/physical-pos/overview',
    '/api/v1/physical-pos/catalog/vendors',
    '/api/v1/physical-pos/catalog/device-models',
    '/api/v1/physical-pos/catalog/acquirers',
  ]);
  assert.deepEqual(queryOf(calls[2]), { vendorCode: 'PAVO', deviceType: 'PHYSICAL', status: 'ACTIVE' });
  assert.ok(calls.every((call) => call.method === 'GET' && call.headers['X-Signature']));
  await assert.rejects(mgmt.listDeviceModels({ environment: 'TEST' }), ConfigurationError);
});

test('createStore generates the required Idempotency-Key and reports 201 / 200', async () => {
  let replayed = false;
  const { mgmt, calls } = makeClient(() => jsonResponse(replayed ? 200 : 201, envelope({ store: store(), replayed }, { statusCode: replayed ? 200 : 201 })));
  const created = await mgmt.createStore({ code: 'IST-01', name: 'Istanbul 1', city: 'Istanbul' });
  assert.equal(target(calls[0]), '/api/v1/physical-pos/stores');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(bodyOf(calls[0]), { code: 'IST-01', name: 'Istanbul 1', city: 'Istanbul' });
  assert.match(calls[0].headers['Idempotency-Key'], UUID_V4);
  assert.equal(created.statusCode, 201);
  assert.equal(created.replayed, false);
  assert.equal(created.store.id, STORE_ID);
  assert.equal(created.idempotencyKey, calls[0].headers['Idempotency-Key']);

  replayed = true;
  const again = await mgmt.createStore({ code: 'IST-01', name: 'Istanbul 1', city: 'Istanbul' }, KEY);
  assert.equal(calls[1].headers['Idempotency-Key'], KEY);
  assert.equal(again.statusCode, 200);
  assert.equal(again.replayed, true);
});

test('updateStore sends null to clear and rowVersion as a JSON integer', async () => {
  const { mgmt, calls } = makeClient(() => jsonResponse(200, envelope({ store: store({ rowVersion: 2 }) })));
  const updated = await mgmt.updateStore(STORE_ID, { rowVersion: 1, city: null, name: 'Istanbul Kadıköy' });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(target(calls[0]), `/api/v1/physical-pos/stores/${STORE_ID}`);
  assert.deepEqual(bodyOf(calls[0]), { rowVersion: 1, name: 'Istanbul Kadıköy', city: null });
  assert.equal(calls[0].headers['Idempotency-Key'], undefined);
  assert.equal(updated.rowVersion, 2);
  await assert.rejects(mgmt.updateStore(STORE_ID, { rowVersion: '1' }), ConfigurationError);
  await assert.rejects(mgmt.updateStore(STORE_ID, { rowVersion: 0 }), ConfigurationError);
  await assert.rejects(mgmt.updateStore(STORE_ID, { rowVersion: 1, code: 'X' }), ConfigurationError);
  assert.equal(calls.length, 1);
});

test('store status changes and audit; registers under a store', async () => {
  const { mgmt, calls } = makeClient((call) => {
    const path = target(call);
    if (path.endsWith('/archive') && path.startsWith('/api/v1/physical-pos/stores')) return jsonResponse(200, envelope({ store: store({ storeStatus: 'ARCHIVED' }), archivedRegisterCount: 2 }));
    if (path.endsWith('/audit')) return jsonResponse(200, envelope({ items: [{ id: 'a1', action: 'physical_pos.audit.store_created' }] }, { pageInfo: { hasMore: false, nextCursor: null, totalCount: null } }));
    if (path.endsWith('/registers') && call.method === 'GET') return jsonResponse(200, envelope({ items: [] }, { pageInfo: { hasMore: false, nextCursor: null, totalCount: 0 } }));
    if (path.endsWith('/registers')) return jsonResponse(201, envelope({ register: { id: REGISTER_ID }, replayed: false }, { statusCode: 201 }));
    return jsonResponse(200, envelope({ register: { id: REGISTER_ID, registerStatus: 'ARCHIVED' }, store: store() }));
  });
  const archived = await mgmt.archiveStore(STORE_ID, { rowVersion: 1, reasonCode: 'STORE_CLOSED' });
  assert.equal(archived.archivedRegisterCount, 2);
  assert.deepEqual(bodyOf(calls[0]), { rowVersion: 1, reasonCode: 'STORE_CLOSED' });
  assert.equal((await mgmt.restoreStore(STORE_ID, { rowVersion: 2, reasonCode: 'REOPENED' })).id, STORE_ID);
  assert.equal(target(calls[1]), `/api/v1/physical-pos/stores/${STORE_ID}/restore`);
  const audit = await mgmt.listStoreAudit(STORE_ID, { limit: 10 });
  assert.equal(audit.items.length, 1);
  await assert.rejects(mgmt.listStoreAudit(STORE_ID, { includeTotal: true }), ConfigurationError);

  const registers = await mgmt.listRegisters(STORE_ID, { includeTotal: true, status: 'ACTIVE' });
  assert.deepEqual(queryOf(calls[3]), { includeTotal: 'true', status: 'ACTIVE' });
  assert.equal(registers.totalCount, 0);
  const register = await mgmt.createRegister(STORE_ID, { code: 'K1', name: 'Till 1' });
  assert.equal(register.statusCode, 201);
  assert.match(calls[4].headers['Idempotency-Key'], UUID_V4);
  await mgmt.updateRegister(REGISTER_ID, { rowVersion: 1, name: 'Till one' });
  assert.equal(target(calls[5]), `/api/v1/physical-pos/registers/${REGISTER_ID}`);
  await mgmt.archiveRegister(REGISTER_ID, { rowVersion: 2, reasonCode: 'REGISTER_REMOVED' });
  await mgmt.restoreRegister(REGISTER_ID, { rowVersion: 3, reasonCode: 'REOPENED' });
  await mgmt.listRegisterAudit(REGISTER_ID);
  assert.deepEqual(calls.slice(6).map(target), [
    `/api/v1/physical-pos/registers/${REGISTER_ID}/archive`,
    `/api/v1/physical-pos/registers/${REGISTER_ID}/restore`,
    `/api/v1/physical-pos/registers/${REGISTER_ID}/audit`,
  ]);
  await assert.rejects(mgmt.archiveStore(STORE_ID, { rowVersion: 1 }), ConfigurationError);
});

test('terminals, bank rows and device links', async () => {
  const { mgmt, calls } = makeClient((call) => {
    const path = target(call);
    if (path.endsWith('/acquirers') && call.method === 'POST') return jsonResponse(201, envelope({ acquirer: { id: ROW_ID }, replayed: false }, { statusCode: 201 }));
    if (path.endsWith('/device-link/close')) return jsonResponse(200, envelope({ terminal: { id: TERMINAL_ID }, link: null }));
    if (path.endsWith('/device-link')) return jsonResponse(200, envelope({ terminal: { id: TERMINAL_ID }, link: { id: 'l1', deviceId: DEVICE_ID } }));
    if (call.method === 'GET' && path === `/api/v1/physical-pos/terminals/${TERMINAL_ID}`) return jsonResponse(200, envelope({ terminal: { id: TERMINAL_ID }, acquirers: { items: [], pageInfo: { hasMore: false, nextCursor: null, totalCount: null } } }));
    if (call.method === 'GET') return jsonResponse(200, envelope({ items: [] }, { pageInfo: { hasMore: false, nextCursor: null } }));
    if (path === '/api/v1/physical-pos/terminals') return jsonResponse(201, envelope({ terminal: { id: TERMINAL_ID }, replayed: false }, { statusCode: 201 }));
    return jsonResponse(200, envelope({ terminal: { id: TERMINAL_ID }, acquirer: { id: ROW_ID } }));
  });
  await mgmt.listTerminals({ status: 'ACTIVE', q: 'T-', includeTotal: false });
  assert.deepEqual(queryOf(calls[0]), { status: 'ACTIVE', q: 'T-', includeTotal: 'false' });
  const created = await mgmt.createTerminal({ code: 'T-01', displayName: 'Till terminal', vendorCode: 'PAVO' }, KEY);
  assert.equal(created.idempotencyKey, KEY);
  assert.equal(created.terminal.id, TERMINAL_ID);
  const detail = await mgmt.getTerminal(TERMINAL_ID);
  assert.equal(detail.terminal.id, TERMINAL_ID);
  assert.ok(Array.isArray(detail.acquirers.items));
  await mgmt.updateTerminal(TERMINAL_ID, { rowVersion: 1, displayName: 'Front till' });
  await mgmt.closeTerminal(TERMINAL_ID, { rowVersion: 2, reasonCode: 'OTHER' });

  const row = await mgmt.addTerminalAcquirer(TERMINAL_ID, {
    vendorAcquirerRef: '62', merchantNumber: '000123', terminalNumber: 'T0001', currencies: ['TRY'],
  });
  assert.equal(row.acquirer.id, ROW_ID);
  assert.match(row.idempotencyKey, UUID_V4);
  await assert.rejects(mgmt.addTerminalAcquirer(TERMINAL_ID, { vendorAcquirerRef: '62', merchantNumber: '1', terminalNumber: '2', currencies: 'TRY' }), ConfigurationError);
  await mgmt.updateTerminalAcquirer(ROW_ID, { rowVersion: 1, label: null, status: 'DISABLED' });
  assert.equal(target(calls[6]), `/api/v1/physical-pos/terminal-acquirers/${ROW_ID}`);
  assert.deepEqual(bodyOf(calls[6]), { rowVersion: 1, label: null, status: 'DISABLED' });
  await mgmt.listTerminalAcquirers(TERMINAL_ID, { includeTotal: true });

  const linked = await mgmt.changeTerminalDevice(TERMINAL_ID, { rowVersion: 3, deviceId: DEVICE_ID, reasonCode: 'DEVICE_REPLACEMENT' });
  assert.equal(linked.link.deviceId, DEVICE_ID);
  assert.equal(calls[8].headers['Idempotency-Key'], undefined);
  const closed = await mgmt.closeTerminalDeviceLink(TERMINAL_ID, { rowVersion: 4, reasonCode: 'DEVICE_FAULT' });
  assert.equal(closed.link, null);
  assert.match(calls[9].headers['Idempotency-Key'], UUID_V4);
  assert.equal(closed.statusCode, 200);
  assert.equal('replayed' in closed, false);
  await mgmt.listTerminalLinks(TERMINAL_ID);
  await mgmt.listTerminalAudit(TERMINAL_ID, { limit: 5 });
  assert.deepEqual(calls.slice(10).map(target), [
    `/api/v1/physical-pos/terminals/${TERMINAL_ID}/links`,
    `/api/v1/physical-pos/terminals/${TERMINAL_ID}/audit`,
  ]);
});

test('devices: create, read, update, assignment, lifecycle and retirement', async () => {
  const { mgmt, calls } = makeClient((call) => {
    const path = target(call);
    if (path === '/api/v1/physical-pos/devices' && call.method === 'POST') return jsonResponse(201, envelope({ device: device(), replayed: false }, { statusCode: 201 }));
    if (path.endsWith('/assignment/close')) return jsonResponse(200, envelope({ device: device(), closedAssignment: { id: 'as1' }, replayed: false }));
    if (path.endsWith('/assignment')) return jsonResponse(200, envelope({ device: device(), assignment: { id: 'as2' }, previousAssignmentId: null }));
    if (path.endsWith('/retire')) return jsonResponse(200, envelope({ device: device({ lifecycleStatus: 'RETIRED' }), replayed: true }));
    if (call.method === 'GET' && (path.endsWith('/assignments') || path.endsWith('/audit') || path.endsWith('/devices'))) {
      return jsonResponse(200, envelope({ items: [device()] }, { pageInfo: { hasMore: false, nextCursor: null, totalCount: 1 } }));
    }
    return jsonResponse(200, envelope({ device: device() }));
  });
  const page = await mgmt.listDevices({ storeId: STORE_ID, lifecycleStatus: 'ACTIVE', q: 'PAV', includeTotal: true, limit: 25 });
  assert.deepEqual(queryOf(calls[0]), { limit: '25', includeTotal: 'true', storeId: STORE_ID, lifecycleStatus: 'ACTIVE', q: 'PAV' });
  assert.equal(page.totalCount, 1);
  const created = await mgmt.createDevice({
    vendorCode: 'PAVO', deviceModelId: 'm1', serialNumber: 'PAV00012345', integrationChannel: 'APP2APP', storeId: STORE_ID,
  });
  assert.equal(created.statusCode, 201);
  assert.match(calls[1].headers['Idempotency-Key'], UUID_V4);
  await assert.rejects(mgmt.createDevice({ vendorCode: 'PAVO', deviceModelId: 'm1', serialNumber: 'S' }), ConfigurationError);

  assert.equal((await mgmt.getDevice(DEVICE_ID)).id, DEVICE_ID);
  await mgmt.updateDevice(DEVICE_ID, { rowVersion: 3, displayName: null, appMode: 'CASHIER' });
  assert.deepEqual(bodyOf(calls[3]), { rowVersion: 3, displayName: null, appMode: 'CASHIER' });

  const assigned = await mgmt.assignDevice(DEVICE_ID, { rowVersion: 4, storeId: STORE_ID, registerId: null, reasonCode: 'INITIAL_SETUP' });
  assert.equal(assigned.assignment.id, 'as2');
  assert.deepEqual(bodyOf(calls[4]), { rowVersion: 4, storeId: STORE_ID, registerId: null, reasonCode: 'INITIAL_SETUP' });
  const storage = await mgmt.closeDeviceAssignment(DEVICE_ID, { rowVersion: 5, reasonCode: 'MOVED_TO_STORAGE' }, KEY);
  assert.equal(storage.closedAssignment.id, 'as1');
  assert.equal(calls[5].headers['Idempotency-Key'], KEY);
  await mgmt.changeDeviceLifecycle(DEVICE_ID, { rowVersion: 6, target: 'SUSPENDED', reasonCode: 'DEVICE_LOST' });
  assert.equal(target(calls[6]), `/api/v1/physical-pos/devices/${DEVICE_ID}/lifecycle`);
  const retired = await mgmt.retireDevice(DEVICE_ID, { rowVersion: 7, reasonCode: 'END_OF_LIFE' });
  assert.equal(retired.replayed, true);
  assert.equal(retired.device.lifecycleStatus, 'RETIRED');
  assert.match(calls[7].headers['Idempotency-Key'], UUID_V4);
  await mgmt.listDeviceAssignments(DEVICE_ID);
  await mgmt.listDeviceAudit(DEVICE_ID);
  assert.deepEqual(calls.slice(8).map(target), [
    `/api/v1/physical-pos/devices/${DEVICE_ID}/assignments`,
    `/api/v1/physical-pos/devices/${DEVICE_ID}/audit`,
  ]);
});

const DEVICE_KEY_ID = 'pdk_AAAAAAAAAAAAAAAAAAAAAAAA';
const deviceKey = (overrides = {}) => ({
  keyId: DEVICE_KEY_ID, algorithm: 'ED25519', keyStatus: 'ACTIVE', enrolledVia: 'PAIRING', fingerprint: 'ABCD-EF12',
  lineageRootKeyId: DEVICE_KEY_ID, rotatedFromKeyId: null, activatedAt: '2026-11-01T09:00:00.000Z', supersededAt: null,
  revokedAt: null, revokeReason: null, rowVersion: 1, ...overrides,
});

test('device identity: keys page, key revocation, enrollment revert, activation-code revocation', async () => {
  const { mgmt, calls } = makeClient((call) => {
    const path = target(call);
    if (path.endsWith('/keys')) return jsonResponse(200, envelope({ items: [deviceKey()] }, { pageInfo: { hasMore: true, nextCursor: 'k1' } }));
    if (path.endsWith('/activation-code/revoke')) {
      return jsonResponse(200, envelope({ deviceId: DEVICE_ID, revokedAt: '2026-11-02T09:00:00.000Z', revokeReason: 'MERCHANT_REVOKED' }));
    }
    return jsonResponse(200, envelope({
      key: deviceKey({ keyStatus: 'REVOKED', revokedAt: '2026-11-02T09:00:00.000Z', revokeReason: 'DEVICE_LOST', rowVersion: 2 }),
      lifecycleStatus: 'SUSPENDED',
      replayed: false,
    }));
  });
  const page = await mgmt.listDeviceKeys(DEVICE_ID, { limit: 10 });
  assert.equal(page.items[0].keyId, DEVICE_KEY_ID);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'k1');
  assert.equal(target(calls[0]), `/api/v1/physical-pos/devices/${DEVICE_ID}/keys`);
  assert.deepEqual(queryOf(calls[0]), { limit: '10' });

  const revoked = await mgmt.revokeDeviceKey(DEVICE_ID, DEVICE_KEY_ID, { rowVersion: 1, reasonCode: 'DEVICE_LOST' });
  assert.equal(calls[1].method, 'POST');
  assert.equal(target(calls[1]), `/api/v1/physical-pos/devices/${DEVICE_ID}/keys/${DEVICE_KEY_ID}/revoke`);
  assert.deepEqual(bodyOf(calls[1]), { rowVersion: 1, reasonCode: 'DEVICE_LOST' });
  assert.equal(calls[1].headers['Idempotency-Key'], undefined);
  assert.equal(revoked.key.keyStatus, 'REVOKED');
  assert.equal(revoked.lifecycleStatus, 'SUSPENDED');
  assert.equal(revoked.replayed, false);

  await mgmt.revertDeviceEnrollment(DEVICE_ID, DEVICE_KEY_ID, { reasonCode: 'NOT_MY_DEVICE' });
  assert.equal(target(calls[2]), `/api/v1/physical-pos/devices/${DEVICE_ID}/keys/${DEVICE_KEY_ID}/revert-enrollment`);
  assert.deepEqual(bodyOf(calls[2]), { reasonCode: 'NOT_MY_DEVICE' });
  assert.equal(calls[2].headers['Idempotency-Key'], undefined);

  const code = await mgmt.revokeActivationCode(DEVICE_ID, { reasonCode: 'MERCHANT_REVOKED' });
  assert.equal(target(calls[3]), `/api/v1/physical-pos/devices/${DEVICE_ID}/activation-code/revoke`);
  assert.deepEqual(bodyOf(calls[3]), { reasonCode: 'MERCHANT_REVOKED' });
  assert.equal(calls[3].headers['Idempotency-Key'], undefined);
  assert.deepEqual(code, { deviceId: DEVICE_ID, revokedAt: '2026-11-02T09:00:00.000Z', revokeReason: 'MERCHANT_REVOKED' });

  await assert.rejects(mgmt.revokeDeviceKey(DEVICE_ID, DEVICE_KEY_ID, { rowVersion: '1', reasonCode: 'OTHER' }), ConfigurationError);
  await assert.rejects(mgmt.revokeDeviceKey(DEVICE_ID, DEVICE_KEY_ID, { reasonCode: 'OTHER' }), ConfigurationError);
  await assert.rejects(mgmt.revokeDeviceKey(DEVICE_ID, '', { rowVersion: 1, reasonCode: 'OTHER' }), ConfigurationError);
  await assert.rejects(mgmt.revertDeviceEnrollment(DEVICE_ID, DEVICE_KEY_ID, { reasonCode: 'OTHER', rowVersion: 1 }), ConfigurationError);
  await assert.rejects(mgmt.revokeActivationCode(DEVICE_ID, {}), ConfigurationError);
  await assert.rejects(mgmt.listDeviceKeys(DEVICE_ID, { includeTotal: true }), ConfigurationError);
  assert.equal(calls.length, 4);
});

test('iterateDeviceKeys follows nextCursor', async () => {
  const { mgmt, calls } = makeClient((call) => (new URL(call.url).searchParams.get('cursor')
    ? jsonResponse(200, envelope({ items: [deviceKey({ keyId: 'pdk_BBBBBBBBBBBBBBBBBBBBBBBB' })] }, { pageInfo: { hasMore: false, nextCursor: null } }))
    : jsonResponse(200, envelope({ items: [deviceKey()] }, { pageInfo: { hasMore: true, nextCursor: 'k1' } }))));
  const ids = [];
  for await (const key of mgmt.iterateDeviceKeys(DEVICE_ID)) ids.push(key.keyId);
  assert.deepEqual(ids, [DEVICE_KEY_ID, 'pdk_BBBBBBBBBBBBBBBBBBBBBBBB']);
  assert.deepEqual(queryOf(calls[1]), { cursor: 'k1' });
});

const provider = (overrides = {}) => ({
  id: PROVIDER_ROW_ID, terminalId: TERMINAL_ID, environment: 'LIVE', providerCode: 'METROPOL', vendorAccountId: VENDOR_ACCOUNT_ID,
  merchantCode: '1000000001', terminalCode: '2000000002', productCode: '3', label: null, providerStatus: 'ACTIVE', rowVersion: 1,
  createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z', ...overrides,
});

test('terminal provider rows: list, add with a key, update without one', async () => {
  const { mgmt, calls } = makeClient((call) => {
    if (call.method === 'GET') return jsonResponse(200, envelope({ items: [provider()] }, { pageInfo: { hasMore: false, nextCursor: null, totalCount: 1 } }));
    if (call.method === 'POST') return jsonResponse(201, envelope({ provider: provider(), replayed: false }, { statusCode: 201 }));
    return jsonResponse(200, envelope({ provider: provider({ providerStatus: 'DISABLED', rowVersion: 2 }) }));
  });
  const page = await mgmt.listTerminalProviders(TERMINAL_ID, { includeTotal: true, limit: 10 });
  assert.equal(target(calls[0]), `/api/v1/physical-pos/terminals/${TERMINAL_ID}/providers`);
  assert.deepEqual(queryOf(calls[0]), { limit: '10', includeTotal: 'true' });
  assert.equal(page.items[0].providerCode, 'METROPOL');
  assert.equal(page.totalCount, 1);

  const request = { vendorAccountId: VENDOR_ACCOUNT_ID, merchantCode: '1000000001', terminalCode: '2000000002', productCode: '3', label: 'Meal' };
  const added = await mgmt.addTerminalProvider(TERMINAL_ID, request, KEY);
  assert.equal(calls[1].method, 'POST');
  assert.equal(target(calls[1]), `/api/v1/physical-pos/terminals/${TERMINAL_ID}/providers`);
  assert.deepEqual(bodyOf(calls[1]), request);
  assert.equal(calls[1].headers['Idempotency-Key'], KEY);
  assert.deepEqual({ id: added.provider.id, replayed: added.replayed, statusCode: added.statusCode, key: added.idempotencyKey },
    { id: PROVIDER_ROW_ID, replayed: false, statusCode: 201, key: KEY });
  await mgmt.addTerminalProvider(TERMINAL_ID, { vendorAccountId: VENDOR_ACCOUNT_ID, merchantCode: '1000000001', terminalCode: '2000000002' });
  assert.match(calls[2].headers['Idempotency-Key'], UUID_V4);

  const updated = await mgmt.updateTerminalProvider(PROVIDER_ROW_ID, { rowVersion: 1, label: null, status: 'DISABLED' });
  assert.equal(calls[3].method, 'PATCH');
  assert.equal(target(calls[3]), `/api/v1/physical-pos/terminal-providers/${PROVIDER_ROW_ID}`);
  assert.deepEqual(bodyOf(calls[3]), { rowVersion: 1, label: null, status: 'DISABLED' });
  assert.equal(calls[3].headers['Idempotency-Key'], undefined);
  assert.equal(updated.providerStatus, 'DISABLED');

  await assert.rejects(mgmt.addTerminalProvider(TERMINAL_ID, { vendorAccountId: VENDOR_ACCOUNT_ID, merchantCode: '1' }), ConfigurationError);
  await assert.rejects(mgmt.addTerminalProvider(TERMINAL_ID, { ...request, providerCode: 'METROPOL' }), ConfigurationError);
  await assert.rejects(mgmt.updateTerminalProvider(PROVIDER_ROW_ID, { label: 'x' }), ConfigurationError);
  await assert.rejects(mgmt.updateTerminalProvider('', { rowVersion: 1 }), ConfigurationError);
  await assert.rejects(mgmt.listTerminalProviders(TERMINAL_ID, { status: 'ACTIVE' }), ConfigurationError);
  assert.equal(calls.length, 4);
});

test('iterateTerminalProviders follows nextCursor', async () => {
  const { mgmt, calls } = makeClient((call) => (new URL(call.url).searchParams.get('cursor')
    ? jsonResponse(200, envelope({ items: [provider({ id: 'p2' })] }, { pageInfo: { hasMore: false, nextCursor: null } }))
    : jsonResponse(200, envelope({ items: [provider()] }, { pageInfo: { hasMore: true, nextCursor: 'p1' } }))));
  const ids = [];
  for await (const row of mgmt.iterateTerminalProviders(TERMINAL_ID)) ids.push(row.id);
  assert.deepEqual(ids, [PROVIDER_ROW_ID, 'p2']);
  assert.deepEqual(queryOf(calls[1]), { cursor: 'p1' });
});

const policy = (overrides = {}) => ({
  scopeType: 'ACCOUNT', storeId: null, deviceId: null, active: true, mode: 'SCHEDULED', scheduleTime: '23:30',
  timeZone: 'Europe/Istanbul', scheduleDays: [], retryWindowMinutes: 120, retryIntervalMinutes: 15,
  offlineBehavior: 'RETRY_IN_WINDOW', overdueAlertHours: 26, rowVersion: 2, updatedAt: '2026-11-03T09:00:00.000Z', ...overrides,
});

test('end-of-day policy: account, store and device levels; clear takes expectedRowVersion as a query', async () => {
  const { mgmt, calls } = makeClient((call) => {
    if (target(call).endsWith('/effective')) {
      return jsonResponse(200, envelope({ effective: {
        deviceId: DEVICE_ID, sourceScopeType: 'STORE', policy: policy({ scopeType: 'STORE', storeId: STORE_ID }),
        serverSettlementSupported: true, deviceAutoSupported: false, nextScheduledAt: '2026-11-03T20:30:00.000Z',
        lastSettlementAt: null, overdue: false, scheduleWarning: null,
      } }));
    }
    return jsonResponse(200, envelope({ policy: policy() }));
  });
  const scheduled = {
    mode: 'SCHEDULED', scheduleTime: '23:30', timeZone: 'Europe/Istanbul', scheduleDays: ['MON', 'FRI'], retryWindowMinutes: 120,
    retryIntervalMinutes: 15, offlineBehavior: 'ALERT_IMMEDIATELY', overdueAlertHours: 26, expectedRowVersion: 1,
  };

  assert.equal((await mgmt.getAccountSettlementPolicy()).mode, 'SCHEDULED');
  await mgmt.setAccountSettlementPolicy(scheduled);
  await mgmt.clearAccountSettlementPolicy();
  await mgmt.getStoreSettlementPolicy(STORE_ID);
  await mgmt.setStoreSettlementPolicy(STORE_ID, { mode: 'MANUAL' });
  await mgmt.clearStoreSettlementPolicy(STORE_ID, 3);
  await mgmt.getDeviceSettlementPolicy(DEVICE_ID);
  await mgmt.setDeviceSettlementPolicy(DEVICE_ID, { mode: 'DEVICE_AUTO', overdueAlertHours: 30 });
  const cleared = await mgmt.clearDeviceSettlementPolicy(DEVICE_ID, 4);
  assert.equal(cleared.rowVersion, 2);
  const effective = await mgmt.getEffectiveSettlementPolicy(DEVICE_ID);
  assert.equal(effective.sourceScopeType, 'STORE');
  assert.equal(effective.policy.storeId, STORE_ID);

  const P = '/api/v1/physical-pos';
  assert.deepEqual(calls.map((call) => [call.method, target(call)]), [
    ['GET', `${P}/settlement-policy`],
    ['PUT', `${P}/settlement-policy`],
    ['DELETE', `${P}/settlement-policy`],
    ['GET', `${P}/stores/${STORE_ID}/settlement-policy`],
    ['PUT', `${P}/stores/${STORE_ID}/settlement-policy`],
    ['DELETE', `${P}/stores/${STORE_ID}/settlement-policy`],
    ['GET', `${P}/devices/${DEVICE_ID}/settlement-policy`],
    ['PUT', `${P}/devices/${DEVICE_ID}/settlement-policy`],
    ['DELETE', `${P}/devices/${DEVICE_ID}/settlement-policy`],
    ['GET', `${P}/devices/${DEVICE_ID}/settlement-policy/effective`],
  ]);
  assert.deepEqual(bodyOf(calls[1]), scheduled);
  assert.deepEqual(bodyOf(calls[4]), { mode: 'MANUAL' });
  assert.deepEqual(bodyOf(calls[7]), { mode: 'DEVICE_AUTO', overdueAlertHours: 30 });
  assert.equal(bodyOf(calls[2]), null);
  assert.deepEqual(queryOf(calls[2]), {});
  assert.deepEqual(queryOf(calls[5]), { expectedRowVersion: '3' });
  assert.deepEqual(queryOf(calls[8]), { expectedRowVersion: '4' });
  for (const call of calls) assert.equal(call.headers['Idempotency-Key'], undefined);
});

test('end-of-day policy requests are checked before sending', async () => {
  const { mgmt, calls } = makeClient(() => jsonResponse(200, envelope({ policy: policy() })));
  await assert.rejects(mgmt.setAccountSettlementPolicy({}), ConfigurationError);
  await assert.rejects(mgmt.setAccountSettlementPolicy({ mode: 'MANUAL', environment: 'LIVE' }), ConfigurationError);
  await assert.rejects(mgmt.setStoreSettlementPolicy(STORE_ID, { mode: 'SCHEDULED', retryWindowMinutes: '120' }), ConfigurationError);
  await assert.rejects(mgmt.setDeviceSettlementPolicy(DEVICE_ID, { mode: 'SCHEDULED', scheduleDays: 'MON' }), ConfigurationError);
  await assert.rejects(mgmt.setDeviceSettlementPolicy(DEVICE_ID, { mode: 'MANUAL', expectedRowVersion: 0 }), ConfigurationError);
  await assert.rejects(mgmt.clearAccountSettlementPolicy('2'), ConfigurationError);
  await assert.rejects(mgmt.clearStoreSettlementPolicy(STORE_ID, 0), ConfigurationError);
  await assert.rejects(mgmt.clearDeviceSettlementPolicy('', 1), ConfigurationError);
  await assert.rejects(mgmt.getEffectiveSettlementPolicy('..'), ConfigurationError);
  assert.equal(calls.length, 0);
});

test('iterateStores follows nextCursor', async () => {
  const { mgmt, calls } = makeClient((call) => (new URL(call.url).searchParams.get('cursor')
    ? jsonResponse(200, envelope({ items: [store({ id: 'b' })] }, { pageInfo: { hasMore: false, nextCursor: null } }))
    : jsonResponse(200, envelope({ items: [store({ id: 'a' })] }, { pageInfo: { hasMore: true, nextCursor: 'n1' } }))));
  const ids = [];
  for await (const row of mgmt.iterateStores({ status: 'ACTIVE' })) ids.push(row.id);
  assert.deepEqual(ids, ['a', 'b']);
  assert.deepEqual(queryOf(calls[1]), { cursor: 'n1', status: 'ACTIVE' });
});

test('card-like keys, unknown filters and bad keys are refused; management 5xx is not an outcome-unknown error', async () => {
  const { mgmt, calls } = makeClient(() => jsonResponse(503, { status: 'failure', code: 'physical_pos.service.busy', statusCode: 503 }));
  await assert.rejects(mgmt.createStore({ code: 'A', name: 'B', cardNumber: '1' }), PhysicalPosCardDataRejectedError);
  await assert.rejects(mgmt.listDevices({ serial: 'x' }), ConfigurationError);
  await assert.rejects(mgmt.createStore({ code: 'A', name: 'B' }, 'bad key'), ConfigurationError);
  await assert.rejects(mgmt.getStore(''), ConfigurationError);
  assert.equal(calls.length, 0);
  await assert.rejects(mgmt.createStore({ code: 'A', name: 'B' }, KEY), (error) => {
    assert.ok(error instanceof ApiError);
    assert.ok(!(error instanceof PhysicalPosOutcomeUnknownError));
    assert.equal(error.statusCode, 503);
    return true;
  });
});
