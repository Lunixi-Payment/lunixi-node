'use strict';

const crypto = require('node:crypto');
const { minor } = require('../money');
const { validateResponseMoney } = require('./physical-pos-money');
const {
  LunixiError,
  ConfigurationError,
  ApiError,
  PhysicalPosCardDataRejectedError,
  PhysicalPosRateLimitError,
  PhysicalPosOutcomeUnknownError,
  PhysicalPosVoidAfterSettlementError,
} = require('../errors');
const {
  PHYSICAL_POS_IDEMPOTENCY_KEY_PATTERN,
  PHYSICAL_POS_MAX_LIMIT,
  PHYSICAL_POS_ROW_VERSION_MAX,
  PHYSICAL_POS_NOT_STARTED_CODES,
  PAYMENT_TARGET_FIELDS,
  SALE_ITEM_FIELDS,
  REFUND_ITEM_FIELDS,
  PHYSICAL_POS_FILTERS,
} = require('./physical-pos-values');

/**
 * Request checks shared by `PhysicalPosClient` and
 * `PhysicalPosManagementClient`: field lists, card data (field names and
 * card-number values), filters, `Idempotency-Key`, paging, the payment-write
 * attempt loop and error mapping.
 */

// ── Card data keys (gateway rule: card-data key tokens) ──────────────────────

const CARD_NUMBER_TERMS = [
  'pan', 'pannumber', 'cardpan', 'cardnumber', 'cardno', 'cardnum', 'cardnr', 'ccnumber', 'ccnum', 'primaryaccountnumber',
];
const CARD_SECRET_TERMS = [
  'cvv', 'cvv2', 'cvc', 'cvc2', 'cvn', 'cvn2', 'cav2', 'cvvcode', 'cvccode', 'cardcode', 'securitycode',
  'cardverificationcode', 'cardverificationvalue', 'track1', 'track2', 'track3', 'tracki', 'trackii', 'trackiii',
  'trackdata', 'magstripe', 'magneticstripe', 'pinblock', 'pincode', 'pinnumber', 'pindata', 'cardpin',
  'cardholderpin', 'encryptedpin', 'expdate', 'expmonth', 'expyear', 'expmmyy', 'expirydate', 'expirymonth',
  'expiryyear', 'expirymmyy', 'expirationdate', 'expirationmonth', 'expirationyear', 'expiremonth', 'expireyear',
  'cardexpiry', 'cardexpiration',
];
const CARD_DATA_SUFFIX_TERMS = [
  'cardnumber', 'pannumber', 'primaryaccountnumber', 'cvv', 'cvv2', 'cvc', 'cvc2', 'cvvcode', 'securitycode',
  'track1', 'track2', 'trackdata', 'pinblock', 'expmonth', 'expyear', 'expirydate', 'expirymonth', 'expiryyear',
  'expirationdate', 'cardexpiry',
];
const WHOLE_KEY_TERMS = ['track', 'expiry', 'expiration', 'pin', 'cid', 'csc'];
const MASK_TOKENS = ['masked', 'mask'];

/** Term lists of the card-data key rule (read-only; the parity test compares them with the shared fixture). */
const CARD_DATA_KEY_RULE = Object.freeze({
  numberTerms: Object.freeze([...CARD_NUMBER_TERMS]),
  secretTerms: Object.freeze([...CARD_SECRET_TERMS]),
  suffixTerms: Object.freeze([...CARD_DATA_SUFFIX_TERMS]),
  wholeKeyTerms: Object.freeze([...WHOLE_KEY_TERMS]),
  maskTokens: Object.freeze([...MASK_TOKENS]),
});

const CARD_DATA_TERMS = new Set([...CARD_NUMBER_TERMS, ...CARD_SECRET_TERMS]);
const WHOLE_KEYS = new Set(WHOLE_KEY_TERMS);
const MASKS = new Set(MASK_TOKENS);
const NUMBER_TERMS = new Set(CARD_NUMBER_TERMS);
const DIGIT_RUN_KEY = /[0-9](?:[ -]?[0-9]){12,}/;
const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function cardDataKeyTokens(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/** True when a field name is card data (`pan`, `cardNumber`, `cvv`, `track2Data`, `expiryDate` …). */
function isCardDataKey(key) {
  const tokens = cardDataKeyTokens(key);
  if (tokens.length === 0) return false;
  if (WHOLE_KEYS.has(tokens.join(''))) return true;
  const masked = tokens.some((token) => MASKS.has(token));
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = '';
    for (let end = start; end < tokens.length; end += 1) {
      joined += tokens[end];
      if (CARD_DATA_TERMS.has(joined) && !(masked && NUMBER_TERMS.has(joined))) return true;
      if (CARD_DATA_SUFFIX_TERMS.some((term) => joined.endsWith(term) && !(masked && NUMBER_TERMS.has(term)))) return true;
    }
  }
  return false;
}

function childPath(path, key) {
  if (!IDENTIFIER_KEY.test(key)) return `${path}[?]`;
  return path === '' ? key : `${path}.${key}`;
}

/**
 * Path of the first card-data key in a body or filter object (`items[1].cvv`),
 * or null. A key holding a 13+ digit run stops at the parent path. Values are
 * not read here.
 */
function findCardDataField(value, root = '(body)') {
  const stack = [{ node: value, path: '' }];
  while (stack.length > 0) {
    const { node, path } = stack.pop();
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) stack.push({ node: node[i], path: `${path}[${i}]` });
      continue;
    }
    if (node === null || typeof node !== 'object' || node instanceof Date) continue;
    const keys = Object.keys(node);
    for (const key of keys) {
      if (DIGIT_RUN_KEY.test(key)) return path === '' ? root : path;
      if (isCardDataKey(key)) return childPath(path, key);
    }
    for (let i = keys.length - 1; i >= 0; i -= 1) stack.push({ node: node[keys[i]], path: childPath(path, keys[i]) });
  }
  return null;
}

// ── Card numbers in values (gateway rule: containsPanLikeValue) ──────────────

const PAN_CANDIDATE = /(?<![\p{L}\p{N}])(?<![\p{L}\p{N}]-)[0-9](?:[ -]?[0-9]){12,18}(?![\p{L}\p{N}])(?!-[\p{L}\p{N}])/gu;

function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function gtinValid(digits) {
  if (!/^(?:[0-9]{8}|[0-9]{12,14})$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * True when the text holds a stand-alone, Luhn-valid 13–19 digit number (plain,
 * space or dash separated). `ITEM_TEXT` (item names only): an unseparated 13 or
 * 14 digit number with a valid GTIN check digit is a barcode, not a card.
 */
function containsPanLikeValue(text, mode = 'STRICT') {
  if (typeof text !== 'string') return false;
  for (const match of text.matchAll(PAN_CANDIDATE)) {
    const digits = match[0].replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (mode === 'ITEM_TEXT' && digits === match[0] && digits.length <= 14 && gtinValid(digits)) continue;
    if (luhnValid(digits)) return true;
  }
  return false;
}

function cardDataRejected(field) {
  return new PhysicalPosCardDataRejectedError(
    'Physical POS requests must not contain card data: the card is read on the device. Remove the field or value; do not send card numbers, expiry dates or security codes.',
    { field, statusCode: 0 },
  );
}

function rejectCardData(value, root) {
  const field = findCardDataField(value, root);
  if (field !== null) throw cardDataRejected(field);
}

/** Card-number values in the free-text fields the gateway scans (the value never reaches the error). */
function rejectCardNumbers(body) {
  if (containsPanLikeValue(body.merchantReference)) throw cardDataRejected('merchantReference');
  (Array.isArray(body.items) ? body.items : []).forEach((item, index) => {
    if (containsPanLikeValue(item.name, 'ITEM_TEXT')) throw cardDataRejected(`items[${index}].name`);
    if (containsPanLikeValue(item.taxGroupCode)) throw cardDataRejected(`items[${index}].taxGroupCode`);
  });
}

const FREE_TEXT_FILTERS = ['merchantReference', 'q'];

// ── Bodies ───────────────────────────────────────────────────────────────────

function plainObject(value, label) {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    throw new ConfigurationError(`${label} must be an object.`);
  }
  return value;
}

function assertKeys(object, allowed, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown ${label} field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}. The gateway rejects unknown fields with 400.`,
    );
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value === '') throw new ConfigurationError(`'${field}' must be a non-empty string.`);
  return value;
}

function requireInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new ConfigurationError(`'${field}' must be an integer (a JSON number, not a string).`);
  }
  return value;
}

function requireRowVersion(value, field) {
  requireInteger(value, field);
  if (value < 1 || value > PHYSICAL_POS_ROW_VERSION_MAX) {
    throw new ConfigurationError(`'${field}' must be between 1 and ${PHYSICAL_POS_ROW_VERSION_MAX}: send the rowVersion you last read.`);
  }
  return value;
}

function objectOf(value, allowed, field, check) {
  const object = plainObject(value, `'${field}'`);
  assertKeys(object, allowed, field);
  const out = {};
  for (const key of allowed) {
    if (object[key] === undefined) continue;
    const checked = check(key, object[key], `${field}.${key}`);
    if (checked !== undefined) out[key] = checked;
  }
  return out;
}

function targetOf(value, field) {
  return objectOf(value, PAYMENT_TARGET_FIELDS, field, (key, entry, path) => checkValue('string', entry, path));
}

const SALE_ITEM_KINDS = {
  lineNo: 'int*', name: 'string*', quantityMilli: 'int*', unitCode: 'string*', unitPriceMinor: 'money*',
  taxGroupCode: 'string*', lineTotalMinor: 'money*', barcode: 'string',
};
const REFUND_ITEM_KINDS = { lineNo: 'int*', quantityMilli: 'int*', amountMinor: 'money' };

function itemsOf(value, allowed, kinds, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigurationError(`'${field}' must be a non-empty array; leave the field out for a request without items.`);
  }
  return value.map((item, index) => {
    const path = `${field}[${index}]`;
    const out = objectOf(item, allowed, path, (key, entry, entryPath) => checkValue(kinds[key], entry, entryPath));
    for (const [key, kind] of Object.entries(kinds)) {
      if (kind.endsWith('*') && out[key] === undefined) throw new ConfigurationError(`'${path}.${key}' is required.`);
    }
    return out;
  });
}

/**
 * Checks one value against its kind (see PHYSICAL_POS_REQUEST_FIELDS).
 * Money is canonical string-only; present null/blank money is rejected.
 * Returns `undefined` to leave non-money fields out. One rule in every language:
 * `null` is sent only for a nullable (`?`) field — an explicit clear — and
 * left out for any other optional field; `''` is left out for an optional
 * string and refused for a required one.
 */
function checkValue(kindSpec, value, field) {
  const required = kindSpec.endsWith('*');
  const nullable = kindSpec.endsWith('?');
  const kind = kindSpec.replace(/[*?]$/, '');
  if (kind === 'money' || kind === 'moneyZero') return minor(value, field, { positive: kind === 'money' });
  if (value === null) {
    if (nullable) return null;
    if (required) throw new ConfigurationError(`'${field}' is required.`);
    return undefined;
  }
  if (value === '' && !required) return undefined;
  switch (kind) {
    case 'string': return requireString(value, field);
    case 'int': return requireInteger(value, field);
    case 'rowVersion': return requireRowVersion(value, field);
    case 'bool':
      if (typeof value !== 'boolean') throw new ConfigurationError(`'${field}' must be a boolean.`);
      return value;
    case 'strings':
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
        throw new ConfigurationError(`'${field}' must be an array of non-empty strings.`);
      }
      return [...value];
    case 'target': return targetOf(value, field);
    case 'saleItems': return itemsOf(value, SALE_ITEM_FIELDS, SALE_ITEM_KINDS, field);
    case 'refundItems': return itemsOf(value, REFUND_ITEM_FIELDS, REFUND_ITEM_KINDS, field);
    default: throw new ConfigurationError(`Unsupported field kind '${kindSpec}'.`);
  }
}

/**
 * Builds a request body from a field list (`PHYSICAL_POS_REQUEST_FIELDS`):
 * card-data keys first (`PhysicalPosCardDataRejectedError`), then unknown
 * fields, required fields and value types (`ConfigurationError`), then
 * card-number values in the scanned free-text fields. Nothing is sent when a
 * check fails.
 */
function buildBody(request, fields, label) {
  if (request !== null && request !== undefined) rejectCardData(request, '(body)');
  const body = plainObject(request, label);
  const allowed = Object.keys(fields);
  assertKeys(body, allowed, label);
  const out = {};
  for (const key of allowed) {
    const kindSpec = fields[key];
    if (body[key] === undefined) {
      if (kindSpec.endsWith('*')) throw new ConfigurationError(`'${key}' is required.`);
      continue;
    }
    const checked = checkValue(kindSpec, body[key], key);
    if (checked !== undefined) out[key] = checked;
  }
  rejectCardNumbers(out);
  return out;
}

// ── Filters ──────────────────────────────────────────────────────────────────

function buildQuery(filters, route) {
  if (filters === null || filters === undefined) return {};
  rejectCardData(filters, '(query)');
  const object = plainObject(filters, 'Physical POS filters');
  const allowed = PHYSICAL_POS_FILTERS[route];
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown physical POS filter(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}. The gateway rejects unknown query fields with 400.`,
    );
  }
  const query = {};
  for (const key of allowed) {
    const value = object[key];
    if (value === undefined) continue;
    if (key === 'amountFromMinor' || key === 'amountToMinor') { query[key] = minor(value, key); continue; }
    if (value === null || value === '') continue;
    query[key] = filterValue(key, value);
    if (FREE_TEXT_FILTERS.includes(key) && containsPanLikeValue(query[key])) throw cardDataRejected(key);
  }
  return query;
}

function filterValue(key, value) {
  if (key === 'limit') {
    if (!Number.isSafeInteger(value) || value < 1 || value > PHYSICAL_POS_MAX_LIMIT) {
      throw new ConfigurationError(`'limit' must be an integer between 1 and ${PHYSICAL_POS_MAX_LIMIT}.`);
    }
    return String(value);
  }
  if (key === 'includeTotal') {
    if (typeof value !== 'boolean') throw new ConfigurationError("'includeTotal' must be a boolean.");
    return value ? 'true' : 'false';
  }
  if (key === 'amountFromMinor' || key === 'amountToMinor') return minor(value, key);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ConfigurationError(`'${key}' is not a valid date.`);
    return key === 'dateFrom' || key === 'dateTo' ? calendarDay(value) : value.toISOString();
  }
  if (typeof value !== 'string') throw new ConfigurationError(`'${key}' must be a string.`);
  return value;
}

/**
 * `dateFrom` / `dateTo` as a `Date`: the Date's own local calendar day
 * (`getFullYear/getMonth/getDate` → `YYYY-MM-DD`). It is not converted to
 * Europe/Istanbul; pass a `YYYY-MM-DD` string to choose the business day
 * exactly.
 */
function calendarDay(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ── Identifiers, Idempotency-Key ─────────────────────────────────────────────

/** A path segment: non-empty, not `.` / `..`, URL-encoded. */
function pathId(value, field) {
  const id = requireString(value, field);
  if (id === '.' || id === '..') throw new ConfigurationError(`'${field}' is not a valid identifier.`);
  return encodeURIComponent(id);
}

/** A new `Idempotency-Key` (UUID v4). Store it with your order before you call. */
function newIdempotencyKey() {
  return crypto.randomUUID();
}

function assertIdempotencyKey(key) {
  if (typeof key !== 'string' || !PHYSICAL_POS_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ConfigurationError(
      'The Idempotency-Key must be 8–200 printable ASCII characters without spaces; it is sent exactly as given. Use a new UUID for every operation and the same key to retry it.',
    );
  }
  return key;
}

/** The key to send where the SDK may create one: the caller's key (checked, never trimmed) or a new UUID for `null`. */
function idempotencyKeyOf(key) {
  if (key === null || key === undefined) return newIdempotencyKey();
  return assertIdempotencyKey(key);
}

/** Payment start and reversal: the caller must pass the key (nothing is generated). */
function requireIdempotencyKey(key, operation) {
  if (key === null || key === undefined) {
    throw new ConfigurationError(
      `A stable Idempotency-Key is required for ${operation}. Create one with PhysicalPosClient.newIdempotencyKey(), store it with your order, then call; when the outcome is unknown call again with the SAME key.`,
    );
  }
  return assertIdempotencyKey(key);
}

// ── Responses ────────────────────────────────────────────────────────────────

function unwrap(response) {
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}

/** `{ items, hasMore, nextCursor, totalCount }` — paging from the envelope's top-level `pageInfo`. */
function toPage(response) {
  const payload = unwrap(response);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pageInfo = response?.pageInfo || payload?.pageInfo || {};
  const nextCursor = typeof pageInfo.nextCursor === 'string' && pageInfo.nextCursor !== '' ? pageInfo.nextCursor : null;
  return {
    items,
    hasMore: pageInfo.hasMore === true && nextCursor !== null,
    nextCursor,
    totalCount: Number.isSafeInteger(pageInfo.totalCount) ? pageInfo.totalCount : null,
  };
}

async function* paginate(fetchPage, filters) {
  let cursor = filters?.cursor ?? undefined;
  for (;;) {
    const page = await fetchPage({ ...(filters || {}), cursor });
    for (const item of page.items) yield item;
    if (!page.hasMore || !page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

/**
 * Keyed management write: the record wrapper of `data` (with `replayed` where
 * the route reports it) plus `statusCode` (envelope) and the key sent.
 */
function writeResult(response, idempotencyKey, fallbackStatus) {
  const data = unwrap(response);
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const replayed = record.replayed === true;
  const statusCode = Number.isInteger(response?.statusCode) ? response.statusCode : fallbackStatus(replayed);
  return { ...record, ...('replayed' in record ? { replayed } : {}), statusCode, idempotencyKey };
}

function numberOrNull(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function detailsOf(error) {
  const body = error instanceof ApiError && error.response && typeof error.response === 'object' ? error.response : {};
  return body.details && typeof body.details === 'object' ? body.details : {};
}

/**
 * Typed physical POS errors for one answered request: card data → field path,
 * void after end-of-day → `allowedOperation`, 429 → `Retry-After` or
 * `details.retryAfterSeconds`. The `idempotencyKey`
 * sent is attached to the error of a write.
 */
function toPhysicalPosError(error, context = {}) {
  if (!(error instanceof ApiError)) return error;
  const details = detailsOf(error);
  const base = {
    statusCode: error.statusCode,
    code: error.code,
    response: error.response,
    requestId: error.requestId,
    cause: error,
  };
  let mapped = error;
  if (error.code === PhysicalPosCardDataRejectedError.CODE) {
    mapped = new PhysicalPosCardDataRejectedError(error.message, {
      ...base,
      field: typeof details.field === 'string' ? details.field : null,
    });
  } else if (error.code === PhysicalPosVoidAfterSettlementError.CODE) {
    mapped = new PhysicalPosVoidAfterSettlementError(error.message, {
      ...base,
      allowedOperation: typeof details.allowedOperation === 'string' ? details.allowedOperation : null,
    });
  } else if (error.statusCode === 429) {
    mapped = new PhysicalPosRateLimitError(error.message, {
      ...base,
      retryAfter: error.retryAfter ?? numberOrNull(details.retryAfterSeconds),
      quota: error.quota || null,
    });
  }
  if (context.idempotencyKey && !mapped.idempotencyKey) mapped.idempotencyKey = context.idempotencyKey;
  return mapped;
}

/** Sends one signed physical POS request (reads and management writes) and maps its errors. */
async function send(api, method, path, body, options = {}) {
  try {
    const response = await api.request(method, path, body, {
      stepUp: true,
      query: options.query,
      idempotencyKey: options.idempotencyKey || null,
    });
    validateResponseMoney(response);
    return response;
  } catch (error) {
    throw toPhysicalPosError(error, options);
  }
}

// ── Payment writes: start, reversal, cancel ──────────────────────────────────

const AMBIGUOUS = 'ambiguous';
const NOT_STARTED = 'not_started';
const DEFINITE = 'definite';

/**
 * One failed attempt of a payment write:
 * - `ambiguous`: no HTTP answer (connect, reset, timeout — also while the body
 *   is read) or a 5xx that does not say "not started". The payment may exist.
 * - `not_started`: a 5xx with a code in `PHYSICAL_POS_NOT_STARTED_CODES`.
 * - `definite`: any 4xx (429 and 409 included).
 */
function attemptOutcome(error) {
  if (!(error instanceof ApiError)) return AMBIGUOUS;
  if (error.statusCode === 0) return AMBIGUOUS;
  if (error.statusCode >= 500) return PHYSICAL_POS_NOT_STARTED_CODES.includes(error.code) ? NOT_STARTED : AMBIGUOUS;
  return DEFINITE;
}

/** Errors raised before anything was sent (configuration, signing). */
function isLocalError(error) {
  return error instanceof LunixiError && !(error instanceof ApiError);
}

function hasPayment(response) {
  try { validateResponseMoney(response); } catch { return false; }
  const payment = unwrap(response)?.payment;
  return payment !== null && typeof payment === 'object' && typeof payment.paymentId === 'string' && payment.paymentId !== '';
}

function outcomeUnknown(lastError, idempotencyKey, attempts) {
  const answered = lastError instanceof ApiError ? lastError : null;
  return new PhysicalPosOutcomeUnknownError(
    'The outcome of the physical POS payment request is unknown: the payment may exist. Call again with the same Idempotency-Key (an existing payment comes back with replayed: true) or look it up; never use a new key for it.',
    {
      statusCode: answered ? answered.statusCode : 0,
      code: answered ? answered.code : null,
      response: answered ? answered.response : null,
      requestId: answered ? answered.requestId : null,
      cause: lastError,
      idempotencyKey,
      attempts,
      retryAfter: answered ? (answered.retryAfter ?? numberOrNull(detailsOf(answered).retryAfterSeconds)) : null,
    },
  );
}

async function backoff(attempt) {
  const delay = Math.min(2000, 100 * 2 ** (attempt - 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Sends a payment write with its own attempts (the transport's retries are off
 * for it): 1 + `maxRetries` attempts, the same key and body every time.
 *
 * Success is only a 2xx carrying a payment. A 2xx without a readable payment,
 * no HTTP answer, or a 5xx that does not say "not started" leaves the outcome
 * unknown; it is retried while attempts remain. A 4xx stops at once. When any
 * attempt was ambiguous the call fails with `PhysicalPosOutcomeUnknownError`
 * whatever the last answer was (a later 429 or 409 included), because the key
 * may already hold a payment.
 */
async function paymentWrite(api, path, body, idempotencyKey, fallbackStatus) {
  const maxRetries = Number.isInteger(api?.config?.maxRetries) && api.config.maxRetries > 0 ? api.config.maxRetries : 0;
  const attempts = 1 + maxRetries;
  let ambiguous = false;
  let lastError = null;
  let made = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    made = attempt;
    let response;
    try {
      response = await api.request('POST', path, body, { stepUp: true, idempotencyKey, retry: false });
    } catch (error) {
      if (isLocalError(error)) {
        if (ambiguous) throw outcomeUnknown(error, idempotencyKey, made);
        throw error;
      }
      lastError = error;
      const outcome = attemptOutcome(error);
      if (outcome === AMBIGUOUS) ambiguous = true;
      if (outcome === DEFINITE) break;
      if (attempt < attempts) await backoff(attempt);
      continue;
    }
    if (hasPayment(response)) {
      const data = unwrap(response);
      const replayed = data.replayed === true;
      const statusCode = Number.isInteger(response.statusCode) ? response.statusCode : fallbackStatus(replayed);
      return { ...data, replayed, statusCode, idempotencyKey };
    }
    ambiguous = true;
    lastError = new ApiError('The gateway accepted the payment request but the answer carries no payment.', {
      statusCode: Number.isInteger(response?.statusCode) ? response.statusCode : 0,
      response,
      requestId: typeof response?.requestId === 'string' ? response.requestId : null,
    });
    if (attempt < attempts) await backoff(attempt);
  }
  if (ambiguous) throw outcomeUnknown(lastError, idempotencyKey, made);
  throw toPhysicalPosError(lastError, { idempotencyKey });
}

module.exports = {
  CARD_DATA_KEY_RULE,
  isCardDataKey,
  findCardDataField,
  containsPanLikeValue,
  buildBody,
  buildQuery,
  pathId,
  requireRowVersion,
  newIdempotencyKey,
  idempotencyKeyOf,
  requireIdempotencyKey,
  unwrap,
  toPage,
  paginate,
  writeResult,
  toPhysicalPosError,
  send,
  paymentWrite,
};
