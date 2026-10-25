'use strict';

const { ConfigurationError } = require('../errors');
const {
  BankConnectionStatus,
  BankAccountStatus,
  BankTransactionDirection,
  BankTransactionType,
  BANK_CONNECT_FILTERS,
  BANK_CONNECT_MAX_LIMIT,
  BANK_CONNECT_MAX_ACCOUNT_FILTER,
  BANK_CONNECT_BOOKED_RANGE_MAX_DAYS,
} = require('./bank-connect-values');
const { paginate, unwrap, toPage } = require('./bank-connect-paging');
const { BankTransferClient, BankFxClient } = require('./bank-transfer-client');

const BASE = '/api/v1/bank-connect';
const DAY_MS = 24 * 60 * 60 * 1000;
const CURSOR_MAX_LENGTH = 2048;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Bank accounts — read your connected bank accounts, balances and
 * transactions (`/api/v1/bank-connect`, product BANK_CONNECT).
 *
 * These routes accept the API key's per-request Ed25519 signature only, so
 * every call is sent `stepUp` (signed), reads included; an unsigned request is
 * 401 `AUTH_HEADERS_MISSING`. Scopes: `bank-connect:view` for banks,
 * connections, accounts and `requestSync()`; `bank-connect:transactions:view`
 * for balances and transactions (403 `API_INSUFFICIENT_SCOPE` otherwise). The
 * key decides the environment: a TEST key reads only test-environment
 * accounts, a LIVE key only live ones.
 *
 * Connecting a bank and entering bank credentials happen in the Lunixi
 * dashboard only. Another organisation's or the other environment's record is
 * 404, the same as a record that does not exist.
 *
 * Money movement lives on two sub-clients, available when the connection
 * offers it (`capabilities` has OUTGOING_TRANSFER / FX_EXCHANGE): `transfers`
 * (`BankTransferClient`) and `fx` (`BankFxClient`). They need the
 * `bank-connect:transfer` scope and a key with an IP allowlist.
 *
 * Responses are the envelope's `data`, unwrapped. List calls return
 * `{ items, hasMore, nextCursor }`. Filters are checked before anything is
 * sent (the gateway rejects an unknown query field with 400): an unknown
 * filter, a value outside its set or a malformed amount or date range is a
 * `ConfigurationError`.
 */
class BankConnectClient {
  constructor(api) {
    this.api = api;
    /** Outgoing transfers from a connected account (`bank-connect:transfer`). */
    this.transfers = new BankTransferClient(api);
    /** Currency exchange between two of your accounts on one connection (`bank-connect:transfer`). */
    this.fx = new BankFxClient(api);
  }

  /** The bank catalogue: whether each bank can be connected and what is read from it. */
  async listBanks(filters = {}) {
    return toPage(await read(this.api, '/banks', buildQuery(filters, 'listBanks')));
  }

  async *iterateBanks(filters = {}) {
    yield* paginate((page) => this.listBanks(page), filters);
  }

  /** Your bank connections, newest first. `status` accepts one value or an array. */
  async listConnections(filters = {}) {
    return toPage(await read(this.api, '/connections', buildQuery(filters, 'listConnections')));
  }

  async *iterateConnections(filters = {}) {
    yield* paginate((page) => this.listConnections(page), filters);
  }

  /** 404 `bank_connect.connection.not_found` for an unknown connection. */
  async getConnection(connectionId) {
    return unwrap(await read(this.api, `/connections/${encodeURIComponent(requireId(connectionId, 'connectionId'))}`));
  }

  /** Your connected accounts, newest first, each with its data `freshness`. */
  async listAccounts(filters = {}) {
    return toPage(await read(this.api, '/accounts', buildQuery(filters, 'listAccounts')));
  }

  async *iterateAccounts(filters = {}) {
    yield* paginate((page) => this.listAccounts(page), filters);
  }

  /** 404 `bank_connect.account.not_found` for an unknown account. */
  async getAccount(accountId) {
    return unwrap(await read(this.api, accountPath(accountId)));
  }

  /**
   * Asks for a fresh read of the account from the bank (HTTP 202).
   *
   * It never reads earlier than the bank's minimum interval: when the interval
   * has not passed the answer is `SCHEDULED` with `scheduledAt`, and a request
   * while one is already waiting joins it. Nothing is written, so no
   * Idempotency-Key is needed. New transactions arrive by the
   * `bank_account.transaction.received` webhook.
   *
   * 409 `bank_connect.connection.not_active` when the connection is not ACTIVE
   * or DEGRADED; 429 `RATE_LIMITED` (a `RateLimitError` with `retryAfter` in
   * seconds) when the key sent too many sync requests in the last minute.
   */
  async requestSync(accountId) {
    return unwrap(await this.api.request('POST', `${BASE}${accountPath(accountId)}/sync`, null, { stepUp: true }));
  }

  /**
   * The latest balance of each account (scope `bank-connect:transactions:view`).
   * Without `accountId`, every active account of the key's environment.
   */
  async listBalances(filters = {}) {
    return toPage(await read(this.api, '/balances', buildQuery(filters, 'listBalances')));
  }

  async *iterateBalances(filters = {}) {
    yield* paginate((page) => this.listBalances(page), filters);
  }

  /**
   * Transactions, newest recorded first (scope `bank-connect:transactions:view`).
   *
   * The order is `receivedAt` (when Lunixi recorded the transaction), which
   * never changes, so paging forward never skips a transaction that arrives
   * late with an older bank date. `bookedFrom` (inclusive) / `bookedTo`
   * (exclusive) filter on the bank date: a `Date` or an ISO-8601 string with a
   * time zone, at most 92 days apart; `bookedTo` needs `bookedFrom`
   * (`bookedFrom` alone runs up to now). Amount filters are inclusive integers
   * in minor units.
   */
  async listTransactions(filters = {}) {
    const query = buildQuery(filters, 'listTransactions');
    assertBookedRange(filters);
    if (query.minAmountMinor !== undefined && query.maxAmountMinor !== undefined && query.minAmountMinor > query.maxAmountMinor) {
      throw new ConfigurationError("'minAmountMinor' must not be greater than 'maxAmountMinor'.");
    }
    return toPage(await read(this.api, '/transactions', query));
  }

  async *iterateTransactions(filters = {}) {
    yield* paginate((page) => this.listTransactions(page), filters);
  }

  /** One transaction with its detail fields (`balanceAfterMinor`, `documentNo`, `bank`). */
  async getTransaction(transactionId) {
    return unwrap(await read(this.api, `/transactions/${encodeURIComponent(requireId(transactionId, 'transactionId'))}`));
  }
}

/** Every bank-connect route is behind SignatureGuard: reads are signed too. */
function read(api, path, query) {
  const options = { stepUp: true };
  if (query && Object.keys(query).length > 0) options.query = query;
  return api.request('GET', `${BASE}${path}`, null, options);
}

function buildQuery(filters, route) {
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new ConfigurationError('Bank-connect filters must be an object.');
  }
  const allowed = BANK_CONNECT_FILTERS[route];
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown bank-connect filter(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}. The gateway rejects unknown query fields with 400.`,
    );
  }
  const query = {};
  for (const key of allowed) {
    const value = filters[key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    query[key] = filterValue(key, value, route);
  }
  return query;
}

function filterValue(key, value, route) {
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
    case 'status':
      return route === 'listAccounts'
        ? oneOf(key, value, Object.values(BankAccountStatus))
        : listOf(key, value, Object.values(BankConnectionStatus));
    case 'direction':
      return oneOf(key, value, Object.values(BankTransactionDirection));
    case 'canonicalType':
      return listOf(key, value, Object.values(BankTransactionType));
    case 'accountId':
      return idList(value);
    case 'bankId':
    case 'connectionId':
      return requireId(value, key);
    case 'currency': {
      const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
      if (!CURRENCY_PATTERN.test(currency)) throw new ConfigurationError("'currency' must be an ISO 4217 code such as TRY.");
      return currency;
    }
    case 'bookedFrom':
    case 'bookedTo':
      return isoTime(key, value);
    case 'minAmountMinor':
    case 'maxAmountMinor':
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ConfigurationError(`'${key}' must be a non-negative integer in minor units (12550 = 125.50 TRY).`);
      }
      return value;
    default:
      throw new ConfigurationError(`Unknown bank-connect filter '${key}'.`);
  }
}

function oneOf(key, value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ConfigurationError(`'${key}' must be one of ${allowed.join(', ')}.`);
  }
  return value;
}

function listOf(key, value, allowed) {
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) oneOf(key, entry, allowed);
  return values.join(',');
}

function idList(value) {
  const ids = Array.isArray(value) ? value : [value];
  if (ids.length > BANK_CONNECT_MAX_ACCOUNT_FILTER) {
    throw new ConfigurationError(`'accountId' takes at most ${BANK_CONNECT_MAX_ACCOUNT_FILTER} account ids.`);
  }
  return ids.map((id) => {
    if (typeof id !== 'string' || id.trim() === '' || id.includes(',')) {
      throw new ConfigurationError("'accountId' must be account ids (strings without commas).");
    }
    return id.trim();
  }).join(',');
}

function isoTime(key, value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ConfigurationError(`'${key}' is an invalid Date.`);
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new ConfigurationError(`'${key}' must be a Date or an ISO-8601 string with a time zone.`);
}

/**
 * The gateway's window rules, checked locally when both ends are readable:
 * `bookedTo` needs `bookedFrom`, `bookedFrom` <= `bookedTo`, at most 92 days.
 */
function assertBookedRange(filters) {
  const present = (value) => value !== undefined && value !== null && value !== '';
  if (present(filters.bookedTo) && !present(filters.bookedFrom)) {
    throw new ConfigurationError("'bookedTo' needs 'bookedFrom': a window without a start is unbounded.");
  }
  const from = epochMs(filters.bookedFrom);
  const to = epochMs(filters.bookedTo);
  if (from === null || to === null) return;
  if (from > to) throw new ConfigurationError("'bookedFrom' must not be after 'bookedTo'.");
  if (to - from > BANK_CONNECT_BOOKED_RANGE_MAX_DAYS * DAY_MS) {
    throw new ConfigurationError(
      `'bookedFrom' and 'bookedTo' may be at most ${BANK_CONNECT_BOOKED_RANGE_MAX_DAYS} days apart. Page through narrower windows.`,
    );
  }
}

function epochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function accountPath(accountId) {
  return `/accounts/${encodeURIComponent(requireId(accountId, 'accountId'))}`;
}

function requireId(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`${field} is required.`);
  }
  return value.trim();
}

module.exports = { BankConnectClient };
