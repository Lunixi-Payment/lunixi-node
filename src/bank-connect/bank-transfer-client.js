'use strict';

const crypto = require('node:crypto');
const { ConfigurationError } = require('../errors');
const {
  BankTransferStatus,
  BankFxOrderStatus,
  BANK_TRANSFER_ROUTES,
  BANK_TRANSFER_IDEMPOTENCY_KEY_PATTERN,
  BANK_TRANSFER_DESCRIPTION_MAX,
  BANK_TRANSFER_RECEIVER_NAME_MIN,
  BANK_TRANSFER_RECEIVER_NAME_MAX,
  BANK_TRANSFER_IBAN_MAX,
  BANK_TRANSFER_PAYMENT_PURPOSE_PATTERN,
  BANK_CONNECT_MAX_LIMIT,
} = require('./bank-connect-values');
const { paginate, unwrap, toPage } = require('./bank-connect-paging');

const CURSOR_MAX_LENGTH = 2048;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const AMOUNT_FIELDS = new Set(['amountMinor', 'sourceAmountMinor', 'targetAmountMinor']);

/**
 * Outgoing bank transfers — `client.bankConnect.transfers`
 * (`/api/v1/bank-connect/transfers`, product BANK_CONNECT).
 *
 * Available on a connection whose `capabilities` include OUTGOING_TRANSFER.
 * Every route, reads included, is signed and needs the
 * `bank-connect:transfer` scope; the key must have an IP allowlist and the
 * request must come from a listed IP (403
 * `bank_connect.auth.ip_allowlist_required` / `bank_connect.auth.ip_not_allowed`).
 *
 * With an API key there is no e-mail code: the key's scope, the signature and
 * the source IP approve the transfer, so `create()` answers SUBMITTED and the
 * transfer is queued for the bank. Follow it with `get()` or the
 * `bank_transfer.*` webhooks. The bank chooses the rail (own account, same
 * bank, FAST or EFT); Lunixi does not check the balance — the bank decides.
 */
class BankTransferClient {
  constructor(api) {
    this.api = api;
  }

  /**
   * Payment purpose codes the bank accepts on this connection. Pass one as
   * `paymentPurpose` to create(); leave it out for the bank's default.
   * Answers `{ items: [{ code, name, order }] }`.
   */
  async listPurposes(connectionId) {
    return unwrap(await invoke(this.api, 'listTransferPurposes', { query: { connectionId: requireId(connectionId, 'connectionId') } }));
  }

  /**
   * Creates an outgoing transfer (HTTP 201): `{ transfer, stepUp, replayed }`.
   *
   * `request`: `accountId` (source account), `receiverIban` (TR IBAN),
   * `receiverName` (2–140 characters), `amountMinor` (integer > 0, minor
   * units: 150075 = 1,500.75 TRY), optional `currency` (TRY), `paymentPurpose`
   * and `description` (at most 140 characters).
   *
   * `idempotencyKey` (8–200 printable ASCII) is generated when left out; the
   * SDK retries a network error or a 5xx with the same key. Keep your own key
   * (e.g. your payout id) to retry safely across processes: the same key with
   * the same body answers the existing transfer with `replayed: true`, the
   * same key with another body is 409 `bank_connect.transfer.idempotency_conflict`.
   * The key used is also in `transfer.idempotencyKey`.
   */
  async create(request, idempotencyKey = undefined) {
    const body = checkBody('createTransfer', request);
    checkTransferBody(body);
    return unwrap(await invoke(this.api, 'createTransfer', {}, body, idempotencyKeyFor(idempotencyKey)));
  }

  /**
   * Transfers, newest first. Filters: `accountId`, `status` (one or a list of
   * BankTransferStatus), `createdFrom` (inclusive) / `createdTo` (exclusive)
   * as a Date or an ISO-8601 string, `limit` 1–100, `cursor`.
   */
  async list(filters = {}) {
    return toPage(await invoke(this.api, 'listTransfers', { query: transferQuery(filters, 'listTransfers') }));
  }

  async *iterate(filters = {}) {
    yield* paginate((page) => this.list(page), filters);
  }

  /** One transfer. 404 `bank_connect.transfer.not_found` for an unknown id. */
  async get(transferId) {
    return unwrap(await invoke(this.api, 'getTransfer', { transferId: requireId(transferId, 'transferId') }));
  }
}

/**
 * Currency exchange between two of your accounts — `client.bankConnect.fx`
 * (`/api/v1/bank-connect/fx`, product BANK_CONNECT).
 *
 * Available on a connection whose `capabilities` include FX_EXCHANGE. The two
 * accounts are active accounts of the same connection in different
 * currencies. Same scope and IP allowlist rule as transfers.
 *
 * Flow: `listRates()` (optional) → `createQuote()` → `createOrder()` with the
 * quote id before `quote.expiresAt` (the bank sets the validity, typically
 * under two minutes; see `validForSeconds`). The order is SUBMITTED and
 * queued; follow it with `getOrder()`. There is no webhook for exchange
 * orders.
 */
class BankFxClient {
  constructor(api) {
    this.api = api;
  }

  /** Current rates on the connection: `{ items, refreshSeconds, fetchedAt }`; rates are decimal strings. */
  async listRates(connectionId) {
    return unwrap(await invoke(this.api, 'listFxRates', { query: { connectionId: requireId(connectionId, 'connectionId') } }));
  }

  /**
   * Quotes an exchange (HTTP 201). `request`: `sourceAccountId` (you sell from
   * it), `targetAccountId` (you buy into it) and exactly one of
   * `sourceAmountMinor` / `targetAmountMinor` (integer > 0, minor units of
   * that account's currency). Nothing is booked; a quote is used by one order.
   */
  async createQuote(request) {
    const body = checkBody('createFxQuote', request);
    const hasSource = body.sourceAmountMinor !== undefined;
    const hasTarget = body.targetAmountMinor !== undefined;
    if (hasSource === hasTarget) {
      throw new ConfigurationError('createFxQuote takes exactly one of sourceAmountMinor and targetAmountMinor.');
    }
    if (body.sourceAccountId === body.targetAccountId) {
      throw new ConfigurationError('createFxQuote needs two different accounts.');
    }
    return unwrap(await invoke(this.api, 'createFxQuote', {}, body));
  }

  /**
   * Executes a quote (HTTP 201): `{ order, replayed }`. `request`: `quoteId`,
   * optional `description` (at most 140 characters). `idempotencyKey`
   * follows the same rule as `transfers.create()` and is generated when left
   * out. 409 `bank_connect.fx.quote_expired` / `bank_connect.fx.quote_used`:
   * ask for a new quote.
   */
  async createOrder(request, idempotencyKey = undefined) {
    const body = checkBody('createFxOrder', request);
    if (body.description !== undefined) checkDescription(body.description);
    return unwrap(await invoke(this.api, 'createFxOrder', {}, body, idempotencyKeyFor(idempotencyKey)));
  }

  /** Exchange orders, newest first. Filters: `status` (one or a list of BankFxOrderStatus), `limit`, `cursor`. */
  async listOrders(filters = {}) {
    return toPage(await invoke(this.api, 'listFxOrders', { query: transferQuery(filters, 'listFxOrders') }));
  }

  async *iterateOrders(filters = {}) {
    yield* paginate((page) => this.listOrders(page), filters);
  }

  /** One exchange order. 404 `bank_connect.fx.order_not_found` for an unknown id. */
  async getOrder(orderId) {
    return unwrap(await invoke(this.api, 'getFxOrder', { orderId: requireId(orderId, 'orderId') }));
  }
}

/** Sends one route of BANK_TRANSFER_ROUTES, signed. */
function invoke(api, routeName, params = {}, body = undefined, idempotencyKey = undefined) {
  const route = BANK_TRANSFER_ROUTES[routeName];
  const path = route.path.replace(/:([A-Za-z]+)/g, (_, name) => encodeURIComponent(params[name]));
  const options = { stepUp: true };
  if (params.query && Object.keys(params.query).length > 0) options.query = params.query;
  if (route.idempotencyKey) options.idempotencyKey = idempotencyKey;
  return api.request(route.method, path, body === undefined ? null : body, options);
}

/** A caller's key is checked; a missing one is generated (UUID v4). */
function idempotencyKeyFor(value) {
  if (value === undefined || value === null || value === '') return crypto.randomUUID();
  if (typeof value !== 'string' || !BANK_TRANSFER_IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ConfigurationError('idempotencyKey must be 8-200 printable ASCII characters (no spaces).');
  }
  return value;
}

/** Whitelists the body against the route: unknown or missing fields fail before sending. */
function checkBody(routeName, request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new ConfigurationError(`${routeName} body must be an object.`);
  }
  const route = BANK_TRANSFER_ROUTES[routeName];
  const allowed = new Set([...route.required, ...route.optional]);
  const body = {};
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined || value === null || value === '') continue;
    if (!allowed.has(key)) {
      throw new ConfigurationError(`${routeName} does not accept ${key} (the gateway rejects unknown fields with 400).`);
    }
    body[key] = AMOUNT_FIELDS.has(key) ? requireAmount(key, value) : value;
  }
  const missing = route.required.filter((key) => body[key] === undefined);
  if (missing.length > 0) throw new ConfigurationError(`${routeName} requires ${missing.join(', ')}.`);
  for (const key of route.required) {
    if (!AMOUNT_FIELDS.has(key)) body[key] = requireText(key, body[key]);
  }
  return body;
}

function checkTransferBody(body) {
  if (body.receiverIban.length > BANK_TRANSFER_IBAN_MAX) {
    throw new ConfigurationError(`'receiverIban' must be at most ${BANK_TRANSFER_IBAN_MAX} characters.`);
  }
  const nameLength = [...body.receiverName].length;
  if (nameLength < BANK_TRANSFER_RECEIVER_NAME_MIN || nameLength > BANK_TRANSFER_RECEIVER_NAME_MAX) {
    throw new ConfigurationError(`'receiverName' must be ${BANK_TRANSFER_RECEIVER_NAME_MIN}-${BANK_TRANSFER_RECEIVER_NAME_MAX} characters.`);
  }
  if (body.currency !== undefined) {
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    if (!CURRENCY_PATTERN.test(currency)) throw new ConfigurationError("'currency' must be an ISO 4217 code such as TRY.");
    body.currency = currency;
  }
  if (body.paymentPurpose !== undefined
    && (typeof body.paymentPurpose !== 'string' || !BANK_TRANSFER_PAYMENT_PURPOSE_PATTERN.test(body.paymentPurpose))) {
    throw new ConfigurationError("'paymentPurpose' must be a code from listPurposes() (letters, digits, underscore; at most 64).");
  }
  if (body.description !== undefined) checkDescription(body.description);
}

function checkDescription(value) {
  if (typeof value !== 'string' || [...value].length > BANK_TRANSFER_DESCRIPTION_MAX) {
    throw new ConfigurationError(`'description' must be a string of at most ${BANK_TRANSFER_DESCRIPTION_MAX} characters.`);
  }
}

function requireAmount(key, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigurationError(`'${key}' must be a positive integer in minor units (150075 = 1,500.75 TRY).`);
  }
  return value;
}

function requireText(key, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new ConfigurationError(`'${key}' must be a non-empty string.`);
  return value.trim();
}

function requireId(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new ConfigurationError(`${field} is required.`);
  return value.trim();
}

/** List filters of listTransfers / listFxOrders, checked against the route's query fields. */
function transferQuery(filters, routeName) {
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new ConfigurationError('Filters must be an object.');
  }
  const allowed = BANK_TRANSFER_ROUTES[routeName].query;
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`Unknown filter(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}. The gateway rejects unknown query fields with 400.`);
  }
  const query = {};
  for (const key of allowed) {
    const value = filters[key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    query[key] = filterValue(key, value, routeName);
  }
  return query;
}

function filterValue(key, value, routeName) {
  switch (key) {
    case 'limit':
      if (!Number.isInteger(value) || value < 1 || value > BANK_CONNECT_MAX_LIMIT) {
        throw new ConfigurationError(`'limit' must be an integer from 1 to ${BANK_CONNECT_MAX_LIMIT}.`);
      }
      return value;
    case 'cursor':
      if (typeof value !== 'string' || value.length > CURSOR_MAX_LENGTH) {
        throw new ConfigurationError("'cursor' must be the nextCursor of the previous page, passed back unchanged.");
      }
      return value;
    case 'status': {
      const set = Object.values(routeName === 'listFxOrders' ? BankFxOrderStatus : BankTransferStatus);
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (typeof entry !== 'string' || !set.includes(entry)) throw new ConfigurationError(`'status' must be one of ${set.join(', ')}.`);
      }
      return values.join(',');
    }
    case 'accountId':
      return requireId(value, 'accountId');
    case 'createdFrom':
    case 'createdTo':
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new ConfigurationError(`'${key}' is an invalid Date.`);
        return value.toISOString();
      }
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      throw new ConfigurationError(`'${key}' must be a Date or an ISO-8601 string.`);
    default:
      throw new ConfigurationError(`Unknown filter '${key}'.`);
  }
}

module.exports = { BankTransferClient, BankFxClient };
