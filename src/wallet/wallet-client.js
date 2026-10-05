'use strict';

const { ConfigurationError } = require('../errors');
const {
  WALLET_ROUTES,
  WALLET_AMOUNT_FIELDS,
  WALLET_NESTED_FIELDS,
  WALLET_IDEMPOTENCY_KEY_MAX,
  AMOUNT_PATTERN,
  WalletQrImageFormat,
} = require('./wallet-values');

/**
 * Wallet — `/api/v1/wallet/*`, the merchant server-to-server surface of the
 * closed-loop wallet.
 *
 * Every route is authenticated by the API key's per-request Ed25519 signature,
 * so every call is sent signed (reads included); the merchant, its programs and
 * its end users come from the signing key. The key also needs:
 *   - the `WALLET_SERVICE` product (otherwise 403 `PRODUCT_NOT_ENABLED`), and
 *   - the wallet permission behind the route (otherwise 403
 *     `WALLET_INSUFFICIENT_SCOPE`): `wallet:*:read` for reads,
 *     `wallet:program|enduser|limit|fee:manage` for set-up,
 *     `wallet:operation:intervene` for moving money inside the wallet,
 *     `wallet:bank-payout:operate` for IBAN transfers and bank withdrawals,
 *     `wallet:qr:manage`, `wallet:bulk:create`, `wallet:bulk:approve`,
 *     `wallet:enduser:kyc-override` for the KYC level.
 *
 * Amounts are minor units as decimal strings (`"12550"` = 125.50 TRY). A call
 * that moves money for an end user names that end user (`endUserId`,
 * `buyerEndUserId`); the source account must belong to them or the answer is
 * 404 `WALLET_NOT_FOUND`.
 *
 * Responses are the gateway envelope's `data`, unwrapped. List calls return
 * `{ items, nextCursor, hasMore, raw }`.
 */
class WalletClient {
  constructor(api) {
    this.api = api;
    const call = (route, params, body, idempotencyKey) => invoke(api, route, params, body, idempotencyKey);
    this.programs = new WalletPrograms(call);
    this.endUsers = new WalletEndUsers(call);
    this.wallets = new WalletAccounts(call);
    this.deposits = new WalletDeposits(call);
    this.corporate = new WalletCorporate(call);
    this.fees = new WalletFees(call);
    this.transfers = new WalletTransfers(call);
    this.withdrawals = new WalletWithdrawals(call);
    this.operations = new WalletOperations(call);
    this.topups = new WalletTopups(call);
    this.payments = new WalletPayments(call);
    this.qr = new WalletQr(api, call);
    this.bulkPayouts = new WalletBulkPayouts(call);
  }

  /** Checks the key reaches the wallet (signature, product, a `wallet:*:manage` permission). */
  async ping() {
    return unwrap(await invoke(this.api, 'ping'));
  }
}

class WalletPrograms {
  constructor(call) { this.call = call; }

  /** The wallet programs of the signing merchant. */
  async listMine() {
    return toPage(await this.call('listMyPrograms'));
  }

  /**
   * Sets the end user whose wallet collects the program's merchant payments.
   * Omitting `collectionEndUserId` clears the anchor.
   */
  async setCollectionAnchor(programId, { collectionEndUserId, reason, expectedVersion } = {}) {
    return unwrap(await this.call('setCollectionAnchor', { programId }, compact({ collectionEndUserId, reason, expectedVersion })));
  }
}

class WalletEndUsers {
  constructor(call) { this.call = call; }

  /** Creates an end user and their default wallet. */
  async create(request, idempotencyKey) {
    return unwrap(await this.call('createEndUser', {}, request, idempotencyKey));
  }

  async list(filters = {}) {
    return toPage(await this.call('listEndUsers', { query: filters }));
  }

  async *iterate(filters = {}) {
    yield* paginate((pageFilters) => this.list(pageFilters), filters);
  }

  async get(endUserId) {
    return unwrap(await this.call('getEndUser', { endUserId }));
  }

  /** Finds an end user by the merchant's own customer id. */
  async getByExternalId(externalCustomerId, programId = undefined) {
    return unwrap(await this.call('getEndUserByExternalId', { externalCustomerId, query: compact({ programId }) }));
  }

  async freeze(endUserId, { reason } = {}, idempotencyKey) {
    return unwrap(await this.call('freezeEndUser', { endUserId }, compact({ reason }), idempotencyKey));
  }

  async getBalances(endUserId) {
    return unwrap(await this.call('getBalances', { endUserId }));
  }

  async getKycLevel(endUserId) {
    return unwrap(await this.call('getKycLevel', { endUserId }));
  }

  /** Records the KYC level from your own verification (`sourceRef` = your KYC session id). */
  async updateKycLevel(endUserId, request, idempotencyKey) {
    return unwrap(await this.call('updateKycLevel', { endUserId }, request, idempotencyKey));
  }

  /** Limit usage per operation type; `operationType` and `currency` narrow the answer. */
  async getLimits(endUserId, { operationType, currency } = {}) {
    return unwrap(await this.call('getLimits', { endUserId, query: compact({ operationType, currency }) }));
  }

  async createWallet(endUserId, { name, currencies } = {}, idempotencyKey) {
    return unwrap(await this.call('createWallet', { endUserId }, compact({ name, currencies }), idempotencyKey));
  }
}

class WalletAccounts {
  constructor(call) { this.call = call; }

  /** Adds a currency account to a wallet. */
  async createAccount(walletId, currency, idempotencyKey) {
    return unwrap(await this.call('createWalletAccount', { walletId }, { currency }, idempotencyKey));
  }

  /** Resolves a wallet number or phone to `{ exists, walletNo, maskedName }` before a transfer. */
  async lookup(request) {
    return unwrap(await this.call('lookupWallet', {}, request));
  }
}

class WalletDeposits {
  constructor(call) { this.call = call; }

  /** Bank transfer details the end user pays into to top up. */
  async listInstructions(endUserId) {
    return unwrap(await this.call('listDepositInstructions', { endUserId }));
  }

  async createInstruction(endUserId, { walletAccountId, currency } = {}) {
    return unwrap(await this.call('createDepositInstruction', { endUserId }, compact({ walletAccountId, currency })));
  }

  /** Test only: books an incoming bank transfer as the bank rail would. */
  async simulateInboundCredit(request) {
    return unwrap(await this.call('simulateInboundCredit', {}, request));
  }
}

class WalletCorporate {
  constructor(call) { this.call = call; }

  async create(request, idempotencyKey) {
    return unwrap(await this.call('createCorporateAccount', {}, request, idempotencyKey));
  }

  async list(filters = {}) {
    return toPage(await this.call('listCorporateAccounts', { query: filters }));
  }

  async *iterate(filters = {}) {
    yield* paginate((pageFilters) => this.list(pageFilters), filters);
  }

  /** Imports up to 1000 employees at once; all or nothing (422 writes nothing). */
  async importEmployees(corporateAccountId, rows, idempotencyKey) {
    return unwrap(await this.call('importCorporateEmployees', { corporateAccountId }, { rows }, idempotencyKey));
  }

  async offboardEmployees(corporateAccountId, rows, { reason } = {}, idempotencyKey) {
    return unwrap(await this.call('offboardCorporateEmployees', { corporateAccountId }, compact({ rows, reason }), idempotencyKey));
  }
}

class WalletFees {
  constructor(call) { this.call = call; }

  /** The fee, tax and total charge an operation would cost. */
  async quote(request) {
    return unwrap(await this.call('quoteFees', {}, request));
  }
}

/**
 * Money moves in two steps: `initiate*` reserves the limit and returns
 * `{ operationId, integrityHash, nonce, otpRequired, … }`; `complete*` with the
 * same `integrityHash` and `nonce` (and the OTP when `otpRequired`) commits it.
 * Quote first to show the fee; pass its `scheduleVersionId` to `initiate*` to
 * hold that fee.
 */
class WalletTransfers {
  constructor(call) { this.call = call; }

  async quoteW2W(request) {
    return unwrap(await this.call('quoteW2W', {}, request));
  }

  async initiateW2W(request, idempotencyKey) {
    return unwrap(await this.call('initiateW2W', {}, request, idempotencyKey));
  }

  async completeW2W(operationId, request, idempotencyKey) {
    return unwrap(await this.call('completeW2W', { operationId }, withOperationId(operationId, request), idempotencyKey));
  }

  async quoteW2Iban(request) {
    return unwrap(await this.call('quoteW2Iban', {}, request));
  }

  async initiateW2Iban(request, idempotencyKey) {
    return unwrap(await this.call('initiateW2Iban', {}, request, idempotencyKey));
  }

  async completeW2Iban(operationId, request, idempotencyKey) {
    return unwrap(await this.call('completeW2Iban', { operationId }, withOperationId(operationId, request), idempotencyKey));
  }
}

/** Withdrawal to the end user's own bank account (same two steps as transfers). */
class WalletWithdrawals {
  constructor(call) { this.call = call; }

  async quote(request) {
    return unwrap(await this.call('quoteBankWithdrawal', {}, request));
  }

  async initiate(request, idempotencyKey) {
    return unwrap(await this.call('initiateBankWithdrawal', {}, request, idempotencyKey));
  }

  async complete(operationId, request, idempotencyKey) {
    return unwrap(await this.call('completeBankWithdrawal', { operationId }, withOperationId(operationId, request), idempotencyKey));
  }

  /** `{ operation, history }` */
  async get(operationId) {
    return unwrap(await this.call('getWithdrawal', { operationId }));
  }
}

class WalletOperations {
  constructor(call) { this.call = call; }

  async list(filters = {}) {
    return toPage(await this.call('listOperations', { query: filters }));
  }

  async *iterate(filters = {}) {
    yield* paginate((pageFilters) => this.list(pageFilters), filters);
  }

  /** `{ operation, history }` */
  async get(operationId) {
    return unwrap(await this.call('getOperation', { operationId }));
  }

  async getReceipt(operationId) {
    return unwrap(await this.call('getOperationReceipt', { operationId }));
  }
}

class WalletTopups {
  constructor(call) { this.call = call; }

  /**
   * Starts a card top-up. Render `checkoutFormContent` (or follow
   * `redirectUrl` / `threeDsHtml`); the wallet is credited when the payment
   * completes (`wallet.topup.completed`).
   */
  async startCard(request, idempotencyKey) {
    return unwrap(await this.call('startCardTopup', {}, request, idempotencyKey));
  }

  /** `{ operation, history }` */
  async get(operationId) {
    return unwrap(await this.call('getTopup', { operationId }));
  }

  /**
   * Refunds a card top-up to the card. Four eyes: `approverPrincipal` is
   * required and must differ from `requesterPrincipal`; binding them to two
   * real people is your approval flow's job.
   */
  async refund(operationId, request) {
    return unwrap(await this.call('refundTopup', { operationId }, request));
  }

  /** Cash top-up through an agent of the program. */
  async agent(request, idempotencyKey) {
    return unwrap(await this.call('agentTopup', {}, request, idempotencyKey));
  }
}

/**
 * The end user pays the merchant. The creditor is the wallet terminal bound to
 * the signing key (`WALLET_TERMINAL_*` 403 without one); a `businessAccountId`
 * in the body is refused.
 */
class WalletPayments {
  constructor(call) { this.call = call; }

  /** Asks the buyer (by wallet number or phone) to pay; approve with `approve()`. */
  async request(request, idempotencyKey) {
    return unwrap(await this.call('requestPayment', {}, request, idempotencyKey));
  }

  async approve(operationId, request, idempotencyKey) {
    return unwrap(await this.call('approvePayment', { operationId }, request, idempotencyKey));
  }

  /** Collects with the payment code the buyer shows (customer-presented). */
  async collect(request, idempotencyKey) {
    return unwrap(await this.call('collectByCode', {}, request, idempotencyKey));
  }

  /** `{ operation, history }` */
  async get(operationId) {
    return unwrap(await this.call('getPayment', { operationId }));
  }

  async getCommission(businessAccountId) {
    return unwrap(await this.call('getBusinessCommission', { businessAccountId }));
  }
}

class WalletQr {
  constructor(api, call) {
    this.api = api;
    this.call = call;
  }

  /** Static QR codes carry no amount; dynamic ones require it. */
  async create(request, idempotencyKey) {
    return unwrap(await this.call('createQr', {}, request, idempotencyKey));
  }

  async list(filters = {}) {
    return toPage(await this.call('listQr', { query: filters }));
  }

  async *iterate(filters = {}) {
    yield* paginate((pageFilters) => this.list(pageFilters), filters);
  }

  async get(qrId) {
    return unwrap(await this.call('getQr', { qrId }));
  }

  /**
   * The QR as an image: `{ contentType, data: Buffer }`.
   * `format` is `svg` (default) or `png`; `scale` 1-20.
   */
  async image(qrId, { format, scale } = {}) {
    if (format !== undefined && !Object.values(WalletQrImageFormat).includes(format)) {
      throw new ConfigurationError(`QR image format must be one of ${Object.values(WalletQrImageFormat).join(', ')}.`);
    }
    if (scale !== undefined && (!Number.isSafeInteger(scale) || scale < 1 || scale > 20)) {
      throw new ConfigurationError('QR image scale must be an integer 1-20.');
    }
    return this.call('getQrImage', { qrId, query: compact({ format, scale }) });
  }

  async revoke(qrId) {
    return unwrap(await this.call('revokeQr', { qrId }));
  }

  /** Decodes a scanned QR payload. */
  async parse(payload) {
    return unwrap(await this.call('parseQr', {}, { payload }));
  }
}

/**
 * Bulk payouts follow maker-checker: the approver must be a DIFFERENT key than
 * the creator (the principal is the signing key id). Creating needs
 * `wallet:bulk:create`; submit, approve, process and retry-failed need
 * `wallet:bulk:approve` — so the maker key holds both, the checker key holds
 * `wallet:bulk:approve`.
 */
class WalletBulkPayouts {
  constructor(call) { this.call = call; }

  async create(request, idempotencyKey) {
    return unwrap(await this.call('createBulkPayout', {}, request, idempotencyKey));
  }

  async list(filters = {}) {
    return toPage(await this.call('listBulkPayouts', { query: filters }));
  }

  async get(batchId) {
    return unwrap(await this.call('getBulkPayout', { batchId }));
  }

  async listItems(batchId, filters = {}) {
    return toPage(await this.call('listBulkPayoutItems', { batchId, query: filters }));
  }

  async submit(batchId) {
    return unwrap(await this.call('submitBulkPayout', { batchId }));
  }

  /** `approve: false` declines the batch with `reason`. */
  async approve(batchId, { approve = true, reason } = {}) {
    return unwrap(await this.call('approveBulkPayout', { batchId }, compact({ approve, reason })));
  }

  async reject(batchId, { reason } = {}) {
    return unwrap(await this.call('rejectBulkPayout', { batchId }, compact({ reason })));
  }

  async process(batchId) {
    return unwrap(await this.call('processBulkPayout', { batchId }));
  }

  async retryFailed(batchId) {
    return unwrap(await this.call('retryFailedBulkPayout', { batchId }));
  }
}

/**
 * Sends one route of `WALLET_ROUTES`, signed. The body and query are checked
 * against the route before anything leaves the process: an unknown field, a
 * missing required field, a non-string amount or a missing Idempotency-Key is
 * a `ConfigurationError`, not a 400 from the gateway.
 */
async function invoke(api, routeName, params = {}, body = undefined, idempotencyKey = undefined) {
  const route = WALLET_ROUTES[routeName];
  const path = fillPath(route.path, params);
  const query = params.query ? pickQuery(routeName, route, params.query) : undefined;
  const hasBody = route.method !== 'GET' && (route.required || route.optional);
  const payload = hasBody ? checkBody(routeName, route, body ?? {}) : undefined;
  const options = { stepUp: true };
  if (query && Object.keys(query).length > 0) options.query = query;
  if (route.binary) options.binary = true;
  if (route.idempotencyKey) {
    options.idempotencyKey = requireIdempotencyKey(routeName, idempotencyKey);
  } else if (idempotencyKey !== undefined && idempotencyKey !== null) {
    throw new ConfigurationError(`${routeName} does not take an Idempotency-Key.`);
  }
  return api.request(route.method, path, payload === undefined ? null : payload, options);
}

function fillPath(template, params) {
  return template.replace(/:([A-Za-z]+)/g, (_, name) => {
    const value = params[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ConfigurationError(`${name} is required.`);
    }
    return encodeURIComponent(value.trim());
  });
}

function checkBody(routeName, route, body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConfigurationError(`${routeName} body must be an object.`);
  }
  const plain = compact(typeof body.toJSON === 'function' ? body.toJSON() : body);
  const allowed = new Set([...(route.required || []), ...(route.optional || [])]);
  const unknown = Object.keys(plain).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`${routeName} does not accept ${unknown.join(', ')} (the gateway rejects unknown fields).`);
  }
  const missing = (route.required || []).filter((key) => plain[key] === undefined || plain[key] === '');
  if (missing.length > 0) {
    throw new ConfigurationError(`${routeName} requires ${missing.join(', ')}.`);
  }
  for (const field of WALLET_AMOUNT_FIELDS) {
    if (plain[field] !== undefined) plain[field] = requireAmount(`${routeName}.${field}`, plain[field]);
  }
  const nested = WALLET_NESTED_FIELDS[routeName];
  if (nested) {
    const listField = routeName === 'createBulkPayout' ? 'items' : 'rows';
    plain[listField] = checkRows(`${routeName}.${listField}`, nested, plain[listField]);
  }
  return plain;
}

function checkRows(label, spec, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ConfigurationError(`${label} must be a non-empty array.`);
  }
  const allowed = new Set([...spec.required, ...spec.optional]);
  return rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new ConfigurationError(`${label}[${index}] must be an object.`);
    }
    const plain = compact(row);
    const unknown = Object.keys(plain).filter((key) => !allowed.has(key));
    if (unknown.length > 0) throw new ConfigurationError(`${label}[${index}] does not accept ${unknown.join(', ')}.`);
    const missing = spec.required.filter((key) => plain[key] === undefined || plain[key] === '');
    if (missing.length > 0) throw new ConfigurationError(`${label}[${index}] requires ${missing.join(', ')}.`);
    if (plain.amount !== undefined) plain.amount = requireAmount(`${label}[${index}].amount`, plain.amount);
    return plain;
  });
}

function pickQuery(routeName, route, filters) {
  const allowed = route.query || [];
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key) && filters[key] !== undefined);
  if (unknown.length > 0) {
    throw new ConfigurationError(`${routeName} does not accept the filter(s) ${unknown.join(', ')}.`);
  }
  return compact(Object.fromEntries(allowed.map((key) => [key, filters[key]])));
}

/**
 * Minor units only. A number is accepted when it is a safe non-negative
 * integer and sent as its decimal string; a float is refused rather than
 * rounded.
 */
function requireAmount(label, value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  if (typeof text !== 'string' || !AMOUNT_PATTERN.test(text)) {
    throw new ConfigurationError(`${label} must be minor units as a digit string (e.g. "12550" for 125.50); got ${JSON.stringify(value)}.`);
  }
  return text;
}

function requireIdempotencyKey(routeName, key) {
  const value = typeof key === 'string' ? key.trim() : '';
  if (!value) {
    throw new ConfigurationError(`A stable Idempotency-Key is required for ${routeName}. Reuse the same key when retrying the same operation.`);
  }
  if (value.length > WALLET_IDEMPOTENCY_KEY_MAX || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigurationError(`Idempotency-Key must be 1-${WALLET_IDEMPOTENCY_KEY_MAX} characters without control characters.`);
  }
  return value;
}

/** The complete DTOs require `operationId` in the body as well; the path wins on the server. */
function withOperationId(operationId, request = {}) {
  if (request.operationId !== undefined && request.operationId !== operationId) {
    throw new ConfigurationError('operationId in the body must match the operation being completed.');
  }
  return { ...request, operationId };
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

function unwrap(response) {
  return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
}

/**
 * Wallet lists answer `{ items, nextCursor }` (operations: `{ operations,
 * nextCursor }`, with `items` and `pageInfo` added by the gateway).
 */
function toPage(response) {
  const data = unwrap(response) ?? {};
  const pageInfo = response?.pageInfo ?? data.pageInfo ?? {};
  const items = Array.isArray(data) ? data : firstArray(data);
  const nextCursor = data.nextCursor ?? pageInfo.nextCursor ?? null;
  return { items, nextCursor, hasMore: Boolean(pageInfo.hasMore ?? nextCursor), raw: data };
}

function firstArray(data) {
  if (Array.isArray(data.items)) return data.items;
  for (const value of Object.values(data)) if (Array.isArray(value)) return value;
  return [];
}

async function* paginate(fetchPage, filters) {
  let cursor = filters.cursor;
  do {
    const page = await fetchPage(cursor ? { ...filters, cursor } : filters);
    for (const item of page.items) yield item;
    cursor = page.nextCursor;
  } while (cursor);
}

module.exports = {
  WalletClient,
  WalletPrograms,
  WalletEndUsers,
  WalletAccounts,
  WalletDeposits,
  WalletCorporate,
  WalletFees,
  WalletTransfers,
  WalletWithdrawals,
  WalletOperations,
  WalletTopups,
  WalletPayments,
  WalletQr,
  WalletBulkPayouts,
};
