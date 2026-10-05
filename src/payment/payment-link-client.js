'use strict';

const { ApiError, ConfigurationError } = require('../errors');
const { toPlain, isoOrNull } = require('./dto');
const {
  PaymentLinkDeliveryChannel,
  PaymentLinkLocale,
  PaymentLinkQrFormat,
  PaymentLinkImageContentType,
  PAYMENT_LINK_SPEC_FIELDS,
  PAYMENT_LINK_IMMUTABLE_FIELDS,
  IDEMPOTENCY_KEY_PATTERN,
  ASSET_ID_PATTERN,
} = require('./payment-link-values');

const BASE = '/api/v1/payments/links';
const IMAGES = `${BASE}/images`;
const UPLOAD_URL_PROTOCOLS = ['https:', 'http:'];

const CREATE_FIELDS = new Set(['environment', ...PAYMENT_LINK_SPEC_FIELDS]);
const UPDATE_FIELDS = new Set(PAYMENT_LINK_SPEC_FIELDS);
const TIME_FIELDS = new Set(['startsAt', 'expiresAt', 'eventAt']);
const LINK_LIST_FILTERS = ['limit', 'cursor', 'includeTotal', 'state', 'usage', 'amountMode', 'environment',
  'tag', 'branchCode', 'createdById', 'query', 'createdFrom', 'createdTo'];
const ATTEMPT_LIST_FILTERS = ['limit', 'cursor', 'includeTotal', 'state'];
const PAYMENT_LIST_FILTERS = ['limit', 'cursor', 'includeTotal'];
const LINK_ACTIONS = ['pause', 'resume', 'deactivate'];
const QR_MIN_SIZE = 128;
const QR_MAX_SIZE = 2048;

/**
 * Payment links — `/api/v1/payments/links`.
 *
 * These routes are authenticated by the API key's per-request Ed25519
 * signature, so every gateway call here is sent `stepUp` (signed), reads
 * included. A request without the signature is 401 `AUTH_HEADERS_MISSING`; a
 * panel session cannot call them. The merchant and the environment come from
 * the signing key: a TEST key sees and changes only TEST links.
 *
 * The one request that is not signed is the image PUT in `uploadImage()`: it
 * goes to the storage host behind a presigned URL, not to the gateway, and
 * carries no credentials at all.
 *
 * The key needs the matching scope (`payment-link:create`, `:view`, `:manage`,
 * `:send`); a missing scope is 403 `API_INSUFFICIENT_SCOPE`.
 *
 * Responses are the gateway envelope's `data`, unwrapped. List calls return
 * `{ items, hasMore, nextCursor, totalCount }`.
 */
class PaymentLinkClient {
  constructor(api) {
    this.api = api;
  }

  /**
   * Creates a payment link. The `Idempotency-Key` is required: repeating the
   * same key with the same body returns the stored link with `replayed: true`
   * (HTTP 200) instead of creating a second one; the same key with a different
   * body is 409 `payment_link.idempotency.conflict`.
   *
   * @param {import('./dto').CreatePaymentLinkRequest|object} request
   * @param {string} idempotencyKey
   */
  async create(request, idempotencyKey) {
    const body = toCreateBody(request);
    return unwrap(await this.api.request('POST', BASE, body, {
      stepUp: true,
      idempotencyKey: requireLinkIdempotencyKey('payment link create', idempotencyKey),
    }));
  }

  /**
   * One page of links, newest first.
   *
   * `state`, `usage` and `amountMode` accept an array (sent as a comma list).
   * `createdFrom`/`createdTo` bound a half-open window `[from, to)`.
   * `query` matches a short code exactly, or a title/reference prefix.
   */
  async list(filters = {}) {
    return toPage(await this.api.request('GET', BASE, null, {
      stepUp: true,
      query: pickQuery(filters, LINK_LIST_FILTERS),
    }));
  }

  /** Iterates every link matching the filters, following cursors. */
  async *iterate(filters = {}) {
    yield* paginate((pageFilters) => this.list(pageFilters), filters);
  }

  async get(linkId) {
    return unwrap(await this.api.request('GET', linkPath(linkId), null, { stepUp: true }));
  }

  /**
   * Changes a link and creates a new version of it.
   *
   * Only the keys present in `changes` are updated; `null` clears a field and a
   * nested object (`recipient`, `checkout`, …) is replaced as a whole.
   * `expectedRowVersion` is the link's current `rowVersion`: if someone changed
   * the link in between, the call is 409 `payment_link.link.version_conflict`.
   * Amount fields are locked (409 `payment_link.link.amount_locked`) while a
   * payment is in progress or once the link has been paid.
   */
  async update(linkId, expectedRowVersion, changes, idempotencyKey = null) {
    const body = { expectedRowVersion: requireRowVersion(expectedRowVersion), ...toUpdateBody(changes) };
    return unwrap(await this.api.request('PATCH', linkPath(linkId), body, {
      stepUp: true,
      idempotencyKey: optionalLinkIdempotencyKey(idempotencyKey),
    }));
  }

  /** Stops accepting payments until `resume()`. */
  pause(linkId, options = {}, idempotencyKey = null) {
    return this.action(linkId, 'pause', options, idempotencyKey);
  }

  resume(linkId, options = {}, idempotencyKey = null) {
    return this.action(linkId, 'resume', options, idempotencyKey);
  }

  /** Permanently closes the link. It cannot be reopened. */
  deactivate(linkId, options = {}, idempotencyKey = null) {
    return this.action(linkId, 'deactivate', options, idempotencyKey);
  }

  /**
   * Sends the link by e-mail or SMS. Without `recipientEmail`/`recipientPhone`
   * the link's `recipient` is used. The `Idempotency-Key` is required so a
   * retried call cannot send twice.
   *
   * A delivery can be accepted and still fail: check `delivery.state` and
   * `delivery.failureReason` (with a TEST key only your organisation's own
   * verified addresses receive messages).
   *
   * @returns {Promise<{delivery: object|null, replayed: boolean}>}
   */
  async send(linkId, { channel, recipientEmail, recipientPhone, locale } = {}, idempotencyKey) {
    const body = { channel: requireChannel(channel) };
    if (recipientEmail !== undefined && recipientEmail !== null) body.recipientEmail = String(recipientEmail);
    if (recipientPhone !== undefined && recipientPhone !== null) body.recipientPhone = String(recipientPhone);
    if (locale !== undefined && locale !== null) body.locale = requireLocale(locale);
    return unwrap(await this.api.request('POST', `${linkPath(linkId)}/send`, body, {
      stepUp: true,
      idempotencyKey: requireLinkIdempotencyKey('payment link send', idempotencyKey),
    }));
  }

  /**
   * The link's QR code as an image. The QR encodes the link URL
   * (`https://pay.lunixi.com/<code>`).
   *
   * @param {{format?: 'svg'|'png', size?: number}} options `size` in pixels, 128–2048 (default 512).
   * @returns {Promise<{contentType: string|null, data: Buffer}>}
   */
  async qr(linkId, { format = PaymentLinkQrFormat.SVG, size } = {}) {
    if (!Object.values(PaymentLinkQrFormat).includes(format)) {
      throw new ConfigurationError(`QR format must be one of ${Object.values(PaymentLinkQrFormat).join(', ')}.`);
    }
    const query = { format };
    if (size !== undefined && size !== null) query.size = requireQrSize(size);
    return this.api.request('GET', `${linkPath(linkId)}/qr`, null, { stepUp: true, binary: true, query });
  }

  /** Payment attempts on the link, newest first. `state` accepts an array. */
  async listAttempts(linkId, filters = {}) {
    return toPage(await this.api.request('GET', `${linkPath(linkId)}/attempts`, null, {
      stepUp: true,
      query: pickQuery(filters, ATTEMPT_LIST_FILTERS),
    }));
  }

  async *iterateAttempts(linkId, filters = {}) {
    yield* paginate((pageFilters) => this.listAttempts(linkId, pageFilters), filters);
  }

  /** Successful payments on the link, with refund totals. */
  async listPayments(linkId, filters = {}) {
    return toPage(await this.api.request('GET', `${linkPath(linkId)}/payments`, null, {
      stepUp: true,
      query: pickQuery(filters, PAYMENT_LIST_FILTERS),
    }));
  }

  async *iteratePayments(linkId, filters = {}) {
    yield* paginate((pageFilters) => this.listPayments(linkId, pageFilters), filters);
  }

  /**
   * Link image, step 1 of 3: an upload URL for a PNG, JPEG or WebP image
   * (`POST /api/v1/payments/links/images`, scope `payment-link:create`).
   *
   * Resolves with `{ assetId, uploadUrl, uploadMethod: 'PUT', uploadHeaders, expiresAt }`.
   * Step 2 is a PUT of the file's bytes to `uploadUrl` with exactly
   * `uploadHeaders`, before `expiresAt`; step 3 is `confirmImageUpload(assetId)`.
   * `uploadImage()` runs all three. `uploadUrl` is the storage host, not the
   * gateway: send it no access token and no signature.
   *
   * `fileName` is recorded only (1–255 characters). A declared `sizeBytes`
   * over the image limit (2 MiB) is refused here, before anything is uploaded
   * (400 `media.public_asset.too_large`); the stored file is measured again on
   * confirmation.
   *
   * @param {{fileName: string, contentType: string, sizeBytes: number}} image
   */
  async createImageUpload({ fileName, contentType, sizeBytes } = {}) {
    const body = {
      fileName: requireString(fileName, 'fileName'),
      contentType: requireImageContentType(contentType),
      sizeBytes: requireImageSize(sizeBytes),
    };
    return requireUploadTarget(unwrap(await this.api.request('POST', IMAGES, body, { stepUp: true })));
  }

  /**
   * Link image, step 3 of 3: publishes an uploaded image
   * (`POST /api/v1/payments/links/images/{assetId}/confirm`, scope `payment-link:create`).
   *
   * Media checks the stored file: its bytes must be the declared type (PNG,
   * JPEG or WebP; never SVG), at most 2 MiB and 4096×4096 px. A file that fails
   * is deleted (400) and has to be uploaded again from `createImageUpload()`;
   * confirming before the PUT has landed is 400 `media.confirm.object_missing`
   * and can be retried.
   *
   * Resolves with `{ assetId, url, state: 'PUBLISHED' }`. Use `assetId` as the
   * `imageAssetId` of a link or an item. `url` is null when the public image
   * host is not configured.
   */
  async confirmImageUpload(assetId) {
    const path = `${IMAGES}/${encodeURIComponent(requireAssetId(assetId))}/confirm`;
    const image = unwrap(await this.api.request('POST', path, {}, { stepUp: true }));
    if (!image || typeof image.assetId !== 'string' || image.state !== 'PUBLISHED') {
      throw new ApiError('Image confirmation did not return a published image.', { response: image ?? null });
    }
    return image;
  }

  /**
   * Uploads a link image in one call: `createImageUpload()`, the PUT of
   * `content` to the returned `uploadUrl`, then `confirmImageUpload()`.
   * Resolves with the published image `{ assetId, url, state }`.
   *
   * The PUT goes straight to the storage host with only `uploadHeaders`. It
   * does not go through the gateway client, so the access token and the
   * request signature are never sent there. A failed PUT is not retried: it
   * rejects with an `ApiError` carrying the storage host's HTTP status (and
   * its error code, e.g. `AccessDenied` once the URL has expired); call
   * `uploadImage()` again for a new upload URL.
   *
   * @param {{fileName: string, contentType: string, content: Buffer|Uint8Array|ArrayBuffer}} image
   */
  async uploadImage({ fileName, contentType, content } = {}) {
    const bytes = requireImageContent(content);
    const target = await this.createImageUpload({ fileName, contentType, sizeBytes: bytes.byteLength });
    await putToStorage(this.api.config, target, bytes);
    return this.confirmImageUpload(target.assetId);
  }

  /**
   * `pause`, `resume` or `deactivate`. `expectedRowVersion` is optional here
   * (omitted = no version check); send it to fail with 409
   * `payment_link.link.version_conflict` if the link changed in between.
   */
  async action(linkId, action, { expectedRowVersion, reason } = {}, idempotencyKey = null) {
    if (!LINK_ACTIONS.includes(action)) {
      throw new ConfigurationError(`Payment link action must be one of ${LINK_ACTIONS.join(', ')}.`);
    }
    const body = {};
    if (expectedRowVersion !== undefined && expectedRowVersion !== null) body.expectedRowVersion = requireRowVersion(expectedRowVersion);
    if (reason !== undefined && reason !== null) body.reason = String(reason);
    return unwrap(await this.api.request('POST', `${linkPath(linkId)}/${action}`, body, {
      stepUp: true,
      idempotencyKey: optionalLinkIdempotencyKey(idempotencyKey),
    }));
  }
}

function toCreateBody(request) {
  const body = toPlain(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConfigurationError('Payment link request must be a CreatePaymentLinkRequest or an object.');
  }
  assertKnownFields(body, CREATE_FIELDS, 'create');
  return normalizeTimes(body);
}

function toUpdateBody(changes) {
  const body = toPlain(changes);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConfigurationError('Payment link changes must be an object.');
  }
  const keys = Object.keys(body).filter((key) => body[key] !== undefined);
  if (keys.length === 0) {
    throw new ConfigurationError('Payment link update needs at least one changed field.');
  }
  for (const key of keys) {
    if (PAYMENT_LINK_IMMUTABLE_FIELDS.includes(key)) {
      throw new ConfigurationError(`'${key}' is fixed when a payment link is created and cannot be updated. Create a new link instead.`);
    }
  }
  assertKnownFields(body, UPDATE_FIELDS, 'update');
  return normalizeTimes(Object.fromEntries(keys.map((key) => [key, body[key]])));
}

function assertKnownFields(body, allowed, operation) {
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`Unknown payment link ${operation} field(s): ${unknown.join(', ')}. The gateway rejects unknown fields with 400.`);
  }
}

function normalizeTimes(body) {
  const out = { ...body };
  for (const key of TIME_FIELDS) {
    if (out[key] !== undefined) out[key] = isoOrNull(out[key], key);
  }
  return out;
}

function pickQuery(filters, allowed) {
  const query = {};
  for (const key of allowed) {
    const value = filters[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) query[key] = value.join(',');
    } else if (value instanceof Date) {
      query[key] = value.toISOString();
    } else {
      query[key] = value;
    }
  }
  return query;
}

async function* paginate(fetchPage, filters) {
  let cursor = filters.cursor ?? undefined;
  for (;;) {
    const page = await fetchPage({ ...filters, cursor });
    for (const item of page.items) yield item;
    if (!page.hasMore || !page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

function unwrap(response) {
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}

/**
 * Reads a list envelope: rows are `data.items`; paging is the envelope's
 * top-level `pageInfo` (a copy inside `data` is read only as a fallback).
 */
function toPage(response) {
  const payload = unwrap(response);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pageInfo = response?.pageInfo || payload?.pageInfo || {};
  const nextCursor = typeof pageInfo.nextCursor === 'string' && pageInfo.nextCursor !== ''
    ? pageInfo.nextCursor
    : null;
  return {
    items,
    hasMore: Boolean(pageInfo.hasMore),
    nextCursor,
    totalCount: typeof pageInfo.totalCount === 'number' ? pageInfo.totalCount : null,
  };
}

function linkPath(linkId) {
  return `${BASE}/${encodeURIComponent(requireString(linkId, 'linkId'))}`;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`${field} is required.`);
  }
  return value.trim();
}

function requireQrSize(value) {
  if (!Number.isSafeInteger(value) || value < QR_MIN_SIZE || value > QR_MAX_SIZE) {
    throw new ConfigurationError(`QR size must be an integer in pixels, ${QR_MIN_SIZE}-${QR_MAX_SIZE}.`);
  }
  return value;
}

function requireLocale(value) {
  const allowed = Object.values(PaymentLinkLocale);
  if (!allowed.includes(value)) {
    throw new ConfigurationError(`Send locale must be one of ${allowed.join(', ')}.`);
  }
  return value;
}

function requireRowVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConfigurationError('expectedRowVersion must be the link\'s current rowVersion (a non-negative integer).');
  }
  return value;
}

function requireChannel(channel) {
  const allowed = Object.values(PaymentLinkDeliveryChannel);
  if (!allowed.includes(channel)) {
    throw new ConfigurationError(`Send channel must be one of ${allowed.join(', ')}.`);
  }
  return channel;
}

function requireImageContentType(value) {
  const allowed = Object.values(PaymentLinkImageContentType);
  if (!allowed.includes(value)) {
    throw new ConfigurationError(`Image contentType must be one of ${allowed.join(', ')} (SVG is not accepted).`);
  }
  return value;
}

function requireImageSize(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigurationError(`Image sizeBytes must be the file size in bytes (a positive integer); got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireImageContent(content) {
  const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new ConfigurationError('Image content must be a non-empty Buffer, Uint8Array or ArrayBuffer.');
  }
  return bytes;
}

function requireAssetId(value) {
  const assetId = typeof value === 'string' ? value.trim() : '';
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new ConfigurationError(`assetId must be the image's asset id (uuid); got ${JSON.stringify(value)}.`);
  }
  return assetId;
}

/**
 * An upload target is used only if the SDK can PUT to it as the contract
 * describes: an asset id, an http(s) URL, the PUT method and header strings.
 * Anything else fails before a byte is sent.
 */
function requireUploadTarget(target) {
  const headers = target?.uploadHeaders;
  const usable = typeof target?.assetId === 'string'
    && ASSET_ID_PATTERN.test(target.assetId)
    && isUploadUrl(target.uploadUrl)
    && target.uploadMethod === 'PUT'
    && headers !== null && typeof headers === 'object' && !Array.isArray(headers)
    && Object.values(headers).every((value) => typeof value === 'string');
  if (!usable) {
    throw new ApiError('Image upload creation did not return a usable upload target.', { response: target ?? null });
  }
  return target;
}

function isUploadUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return UPLOAD_URL_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * The PUT to the presigned upload URL. It deliberately does NOT use
 * `ApiClient.request()`: that adds the bearer access token and the Ed25519
 * signature headers, which must never reach the storage host (a presigned URL
 * also rejects a request that carries an `Authorization` header). Only the
 * headers the URL was signed for are sent.
 */
async function putToStorage(config, target, bytes) {
  let response;
  try {
    response = await config.fetch(target.uploadUrl, {
      method: 'PUT',
      headers: { ...target.uploadHeaders },
      body: bytes,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new ApiError(`Image upload to storage failed: ${error.message}`, { cause: error });
  }
  if (!response.ok) {
    const code = storageErrorCode(await readText(response));
    throw new ApiError(`Image upload to storage failed (HTTP ${response.status}${code ? `, ${code}` : ''}).`, {
      statusCode: response.status,
      code,
    });
  }
}

/** S3-compatible storage answers errors as XML: `<Error><Code>AccessDenied</Code>…`. */
function storageErrorCode(text) {
  const match = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/.exec(text);
  return match ? match[1] : null;
}

async function readText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function requireLinkIdempotencyKey(operation, key) {
  const value = typeof key === 'string' ? key.trim() : '';
  if (!value) {
    throw new ConfigurationError(`A stable Idempotency-Key is required for ${operation}. Reuse the same key when retrying the same operation.`);
  }
  return assertIdempotencyKeyFormat(value);
}

function optionalLinkIdempotencyKey(key) {
  if (key === null || key === undefined || key === '') return null;
  return assertIdempotencyKeyFormat(String(key).trim());
}

function assertIdempotencyKeyFormat(value) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ConfigurationError('Idempotency-Key must be 8-200 printable ASCII characters without spaces.');
  }
  return value;
}

module.exports = { PaymentLinkClient };
