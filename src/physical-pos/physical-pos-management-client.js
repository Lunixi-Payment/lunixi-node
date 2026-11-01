'use strict';

const { PHYSICAL_POS_REQUEST_FIELDS: FIELDS } = require('./physical-pos-values');
const {
  buildBody,
  buildQuery,
  pathId,
  idempotencyKeyOf,
  unwrap,
  toPage,
  paginate,
  writeResult,
  send,
} = require('./physical-pos-request');

const BASE = '/api/v1/physical-pos';
const CREATED = (replayed) => (replayed ? 200 : 201);
const OK = () => 200;

/**
 * Physical POS management — stores, registers, logical terminals with their
 * bank rows and device links, devices, the catalog and the overview
 * (`/api/v1/physical-pos`). Reads need `physical_pos:view`, writes
 * `physical_pos:manage`; a TEST key can only read.
 *
 * Updates and status changes take the `rowVersion` you last read (409
 * `physical_pos.version_conflict` when the record changed). Reason codes are
 * closed sets checked by the gateway (400 `physical_pos.input.reason_code_invalid`).
 * Routes that require an `Idempotency-Key` get a new UUID when you pass
 * `null`; a key you pass is sent exactly as given (never trimmed; '' is
 * refused). The key sent comes back as `idempotencyKey`. A key belongs to one operation:
 * reusing it for another body or route is 409 `physical_pos.idempotency_mismatch`.
 *
 * Page results are `{ items, hasMore, nextCursor, totalCount }`;
 * `totalCount` is filled only with `includeTotal: true` on entity lists.
 */
class PhysicalPosManagementClient {
  constructor(api) {
    this.api = api;
  }

  /** Store, register, terminal and device counts (`GET /overview`). */
  async getOverview() {
    const data = unwrap(await this.read('/overview'));
    return data?.overview ?? data;
  }

  // ── Catalog ──────────────────────────────────────────────────────────────

  /** Device vendors (`GET /catalog/vendors`). */
  async listVendors() {
    return unwrap(await this.read('/catalog/vendors'));
  }

  /** Device models; filters `vendorCode`, `deviceType`, `status` (`GET /catalog/device-models`). */
  async listDeviceModels(filters = {}) {
    return unwrap(await this.read('/catalog/device-models', buildQuery(filters, 'listDeviceModels')));
  }

  /** Banks a terminal row can belong to (`GET /catalog/acquirers`). */
  async listAcquirers() {
    return unwrap(await this.read('/catalog/acquirers'));
  }

  // ── Stores ───────────────────────────────────────────────────────────────

  async listStores(filters = {}) {
    return toPage(await this.read('/stores', buildQuery(filters, 'listStores')));
  }

  async *iterateStores(filters = {}) {
    yield* paginate((page) => this.listStores(page), filters);
  }

  /** `{ store, replayed, statusCode (201 new / 200 replay), idempotencyKey }`. */
  async createStore(request, idempotencyKey = null) {
    return this.keyedWrite('/stores', buildBody(request, FIELDS.createStore, 'createStore request'), idempotencyKey, CREATED);
  }

  /** `{ store, registerSummary: { activeCount, archivedCount }, assignedDeviceCount }`. */
  async getStore(storeId) {
    return unwrap(await this.read(`/stores/${pathId(storeId, 'storeId')}`));
  }

  /** `null` clears `city`, `district`, `addressLine`, `externalRef`; a field left out is unchanged. */
  async updateStore(storeId, request) {
    return this.record('PATCH', `/stores/${pathId(storeId, 'storeId')}`, buildBody(request, FIELDS.updateStore, 'updateStore request'), 'store');
  }

  /** `{ store, archivedRegisterCount }`; the active registers are archived with it. */
  async archiveStore(storeId, request) {
    return unwrap(await this.post(`/stores/${pathId(storeId, 'storeId')}/archive`, statusChange(request, 'archiveStore')));
  }

  async restoreStore(storeId, request) {
    return this.record('POST', `/stores/${pathId(storeId, 'storeId')}/restore`, statusChange(request, 'restoreStore'), 'store');
  }

  async listStoreAudit(storeId, filters = {}) {
    return toPage(await this.read(`/stores/${pathId(storeId, 'storeId')}/audit`, buildQuery(filters, 'history')));
  }

  async *iterateStoreAudit(storeId, filters = {}) {
    yield* paginate((page) => this.listStoreAudit(storeId, page), filters);
  }

  // ── Registers ────────────────────────────────────────────────────────────

  async listRegisters(storeId, filters = {}) {
    return toPage(await this.read(`/stores/${pathId(storeId, 'storeId')}/registers`, buildQuery(filters, 'listRegisters')));
  }

  async *iterateRegisters(storeId, filters = {}) {
    yield* paginate((page) => this.listRegisters(storeId, page), filters);
  }

  /** `{ register, replayed, statusCode, idempotencyKey }`. */
  async createRegister(storeId, request, idempotencyKey = null) {
    const path = `/stores/${pathId(storeId, 'storeId')}/registers`;
    return this.keyedWrite(path, buildBody(request, FIELDS.createRegister, 'createRegister request'), idempotencyKey, CREATED);
  }

  async updateRegister(registerId, request) {
    const path = `/registers/${pathId(registerId, 'registerId')}`;
    return this.record('PATCH', path, buildBody(request, FIELDS.updateRegister, 'updateRegister request'), 'register');
  }

  async archiveRegister(registerId, request) {
    return this.record('POST', `/registers/${pathId(registerId, 'registerId')}/archive`, statusChange(request, 'archiveRegister'), 'register');
  }

  async restoreRegister(registerId, request) {
    return this.record('POST', `/registers/${pathId(registerId, 'registerId')}/restore`, statusChange(request, 'restoreRegister'), 'register');
  }

  async listRegisterAudit(registerId, filters = {}) {
    return toPage(await this.read(`/registers/${pathId(registerId, 'registerId')}/audit`, buildQuery(filters, 'history')));
  }

  async *iterateRegisterAudit(registerId, filters = {}) {
    yield* paginate((page) => this.listRegisterAudit(registerId, page), filters);
  }

  // ── Logical terminals ────────────────────────────────────────────────────

  async listTerminals(filters = {}) {
    return toPage(await this.read('/terminals', buildQuery(filters, 'listTerminals')));
  }

  async *iterateTerminals(filters = {}) {
    yield* paginate((page) => this.listTerminals(page), filters);
  }

  /** `{ terminal, replayed, statusCode, idempotencyKey }`. */
  async createTerminal(request, idempotencyKey = null) {
    return this.keyedWrite('/terminals', buildBody(request, FIELDS.createTerminal, 'createTerminal request'), idempotencyKey, CREATED);
  }

  /** `{ terminal, acquirers: { items, pageInfo } }`. */
  async getTerminal(terminalId) {
    return unwrap(await this.read(`/terminals/${pathId(terminalId, 'terminalId')}`));
  }

  async updateTerminal(terminalId, request) {
    const path = `/terminals/${pathId(terminalId, 'terminalId')}`;
    return this.record('PATCH', path, buildBody(request, FIELDS.updateTerminal, 'updateTerminal request'), 'terminal');
  }

  async closeTerminal(terminalId, request) {
    return this.record('POST', `/terminals/${pathId(terminalId, 'terminalId')}/close`, statusChange(request, 'closeTerminal'), 'terminal');
  }

  /** Bank rows of a terminal; a row's `id` is the payment's `terminalAcquirerId`. */
  async listTerminalAcquirers(terminalId, filters = {}) {
    const path = `/terminals/${pathId(terminalId, 'terminalId')}/acquirers`;
    return toPage(await this.read(path, buildQuery(filters, 'listTerminalAcquirers')));
  }

  async *iterateTerminalAcquirers(terminalId, filters = {}) {
    yield* paginate((page) => this.listTerminalAcquirers(terminalId, page), filters);
  }

  /** `{ acquirer, replayed, statusCode, idempotencyKey }`. */
  async addTerminalAcquirer(terminalId, request, idempotencyKey = null) {
    const path = `/terminals/${pathId(terminalId, 'terminalId')}/acquirers`;
    return this.keyedWrite(path, buildBody(request, FIELDS.addTerminalAcquirer, 'addTerminalAcquirer request'), idempotencyKey, CREATED);
  }

  async updateTerminalAcquirer(terminalAcquirerId, request) {
    const path = `/terminal-acquirers/${pathId(terminalAcquirerId, 'terminalAcquirerId')}`;
    return this.record('PATCH', path, buildBody(request, FIELDS.updateTerminalAcquirer, 'updateTerminalAcquirer request'), 'acquirer');
  }

  /** Links the terminal to a device (closing the previous link): `{ terminal, link }`. */
  async changeTerminalDevice(terminalId, request) {
    const path = `/terminals/${pathId(terminalId, 'terminalId')}/device-link`;
    return unwrap(await this.post(path, buildBody(request, FIELDS.changeTerminalDevice, 'changeTerminalDevice request')));
  }

  /** `{ terminal, link, replayed, statusCode, idempotencyKey }` (`link` = the closed link or null). */
  async closeTerminalDeviceLink(terminalId, request, idempotencyKey = null) {
    const path = `/terminals/${pathId(terminalId, 'terminalId')}/device-link/close`;
    return this.keyedWrite(path, statusChange(request, 'closeTerminalDeviceLink'), idempotencyKey, OK);
  }

  async listTerminalLinks(terminalId, filters = {}) {
    return toPage(await this.read(`/terminals/${pathId(terminalId, 'terminalId')}/links`, buildQuery(filters, 'history')));
  }

  async *iterateTerminalLinks(terminalId, filters = {}) {
    yield* paginate((page) => this.listTerminalLinks(terminalId, page), filters);
  }

  async listTerminalAudit(terminalId, filters = {}) {
    return toPage(await this.read(`/terminals/${pathId(terminalId, 'terminalId')}/audit`, buildQuery(filters, 'history')));
  }

  async *iterateTerminalAudit(terminalId, filters = {}) {
    yield* paginate((page) => this.listTerminalAudit(terminalId, page), filters);
  }

  // ── Devices ──────────────────────────────────────────────────────────────

  async listDevices(filters = {}) {
    return toPage(await this.read('/devices', buildQuery(filters, 'listDevices')));
  }

  async *iterateDevices(filters = {}) {
    yield* paginate((page) => this.listDevices(page), filters);
  }

  /** `{ device, replayed, statusCode, idempotencyKey }`. */
  async createDevice(request, idempotencyKey = null) {
    return this.keyedWrite('/devices', buildBody(request, FIELDS.createDevice, 'createDevice request'), idempotencyKey, CREATED);
  }

  async getDevice(deviceId) {
    const data = unwrap(await this.read(`/devices/${pathId(deviceId, 'deviceId')}`));
    return data?.device ?? data;
  }

  async updateDevice(deviceId, request) {
    const path = `/devices/${pathId(deviceId, 'deviceId')}`;
    return this.record('PATCH', path, buildBody(request, FIELDS.updateDevice, 'updateDevice request'), 'device');
  }

  /** Assigns the device to a store (and register): `{ device, assignment, previousAssignmentId }`. */
  async assignDevice(deviceId, request) {
    const path = `/devices/${pathId(deviceId, 'deviceId')}/assignment`;
    return unwrap(await this.post(path, buildBody(request, FIELDS.assignDevice, 'assignDevice request')));
  }

  /** Moves the device to storage: `{ device, closedAssignment, replayed, idempotencyKey }`. */
  async closeDeviceAssignment(deviceId, request, idempotencyKey = null) {
    const path = `/devices/${pathId(deviceId, 'deviceId')}/assignment/close`;
    return this.keyedWrite(path, statusChange(request, 'closeDeviceAssignment'), idempotencyKey, OK);
  }

  /** `target`: ACTIVE, SUSPENDED or MAINTENANCE. */
  async changeDeviceLifecycle(deviceId, request) {
    const path = `/devices/${pathId(deviceId, 'deviceId')}/lifecycle`;
    return this.record('POST', path, buildBody(request, FIELDS.changeDeviceLifecycle, 'changeDeviceLifecycle request'), 'device');
  }

  /** `{ device, replayed, idempotencyKey }`. Retirement is final. */
  async retireDevice(deviceId, request, idempotencyKey = null) {
    const path = `/devices/${pathId(deviceId, 'deviceId')}/retire`;
    return this.keyedWrite(path, statusChange(request, 'retireDevice'), idempotencyKey, OK);
  }

  async listDeviceAssignments(deviceId, filters = {}) {
    return toPage(await this.read(`/devices/${pathId(deviceId, 'deviceId')}/assignments`, buildQuery(filters, 'history')));
  }

  async *iterateDeviceAssignments(deviceId, filters = {}) {
    yield* paginate((page) => this.listDeviceAssignments(deviceId, page), filters);
  }

  async listDeviceAudit(deviceId, filters = {}) {
    return toPage(await this.read(`/devices/${pathId(deviceId, 'deviceId')}/audit`, buildQuery(filters, 'history')));
  }

  async *iterateDeviceAudit(deviceId, filters = {}) {
    yield* paginate((page) => this.listDeviceAudit(deviceId, page), filters);
  }

  // ── Transport ────────────────────────────────────────────────────────────

  read(path, query) {
    return send(this.api, 'GET', `${BASE}${path}`, null, { query });
  }

  post(path, body) {
    return send(this.api, 'POST', `${BASE}${path}`, body);
  }

  async record(method, path, body, name) {
    const data = unwrap(await send(this.api, method, `${BASE}${path}`, body));
    return data?.[name] ?? data;
  }

  async keyedWrite(path, body, idempotencyKey, fallbackStatus) {
    const key = idempotencyKeyOf(idempotencyKey);
    const response = await send(this.api, 'POST', `${BASE}${path}`, body, { idempotencyKey: key });
    return writeResult(response, key, fallbackStatus);
  }
}

function statusChange(request, operation) {
  return buildBody(request, FIELDS.statusChange, `${operation} request`);
}

module.exports = { PhysicalPosManagementClient };
