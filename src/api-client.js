'use strict';

const crypto = require('node:crypto');
const {
  ApiError,
  ValidationError,
  RateLimitError,
  ServiceUnavailableError,
} = require('./errors');
const {
  HEADER_KEY_ID,
  HEADER_DATE,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  HEADER_DIGEST,
  buildCanonicalRequest,
  digestForBody,
} = require('./auth/canonical-request');

class ApiClient {
  constructor(config, signer, tokenManager) {
    this.config = config;
    this.signer = signer;
    this.tokenManager = tokenManager;
  }

  /**
   * Sends one gateway request.
   *
   * Every call carries the bearer access token. `stepUp: true` adds the
   * per-request Ed25519 signature (`X-Key-Id`, `X-Date`, `X-Nonce`,
   * `X-Signature` and, with a body, `Digest`); routes guarded by the API-key
   * signature reject a request without it.
   *
   * `binary: true` returns `{ contentType, data: Buffer }` for a 2xx response
   * instead of parsing JSON (image endpoints). Errors are still read as JSON.
   */
  async request(method, path, body = null, options = {}) {
    const upperMethod = method.toUpperCase();
    const signedPath = withQuery(path, options.query);
    const url = this.config.baseUrl + signedPath;
    const rawBody = body === null || body === undefined ? null : JSON.stringify(body);
    const idempotencyKey = options.idempotencyKey || null;
    const idempotent = upperMethod === 'GET' || upperMethod === 'HEAD' || Boolean(idempotencyKey);
    const accept = options.binary ? BINARY_ACCEPT : JSON_ACCEPT;
    let reAuthed = false;

    for (let attempt = 1; ; attempt += 1) {
      const headers = await this.buildHeaders(upperMethod, signedPath, rawBody, Boolean(options.stepUp), idempotencyKey, accept);

      let response;
      try {
        response = await this.config.fetch(url, {
          method: upperMethod,
          headers,
          body: rawBody,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (error) {
        if (idempotent && attempt <= this.config.maxRetries) {
          await backoff(attempt);
          continue;
        }
        throw new ApiError(`Gateway request failed: ${error.message}`, { cause: error });
      }

      if (response.ok) return options.binary ? readBinary(response) : readJson(response);

      if (response.status === 401 && !reAuthed) {
        this.tokenManager.invalidate();
        reAuthed = true;
        continue;
      }

      if (response.status >= 500 && idempotent && attempt <= this.config.maxRetries) {
        await backoff(attempt);
        continue;
      }

      throw await toApiError(response);
    }
  }

  async buildHeaders(method, signedPath, rawBody, stepUp, idempotencyKey, accept = JSON_ACCEPT) {
    const headers = {
      Accept: accept,
      'User-Agent': this.config.userAgent,
      Authorization: `Bearer ${await this.tokenManager.getToken()}`,
    };
    if (rawBody !== null) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    if (stepUp) {
      const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const nonce = crypto.randomBytes(16).toString('hex');
      const digest = rawBody !== null ? digestForBody(rawBody) : null;
      const canonical = buildCanonicalRequest(method, signedPath, date, nonce, digest);

      headers[HEADER_KEY_ID] = this.config.keyId;
      headers[HEADER_DATE] = date;
      headers[HEADER_NONCE] = nonce;
      headers[HEADER_SIGNATURE] = this.signer.sign(canonical);
      if (digest) headers[HEADER_DIGEST] = digest;
    }

    return headers;
  }
}

const JSON_ACCEPT = 'application/json';
const BINARY_ACCEPT = 'image/svg+xml, image/png, application/json';

function withQuery(path, query) {
  if (!query || Object.keys(query).length === 0) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function readBinary(response) {
  return {
    contentType: response.headers?.get?.('content-type') || null,
    data: Buffer.from(await response.arrayBuffer()),
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function numericHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Quota headers are stamped on 429/503 only, and only when the gateway actually
 * knows the numbers — it omits a header rather than guessing, so a client that
 * invented a limit would retry at the wrong rate.
 */
function readQuota(headers) {
  const quota = {
    rateLimit: numericHeader(headers, 'x-ratelimit-limit'),
    rateRemaining: numericHeader(headers, 'x-ratelimit-remaining'),
    rateReset: numericHeader(headers, 'x-ratelimit-reset'),
    dailyLimit: numericHeader(headers, 'x-quota-limit'),
    dailyRemaining: numericHeader(headers, 'x-quota-remaining'),
    dailyReset: numericHeader(headers, 'x-quota-reset'),
  };
  return Object.values(quota).some((value) => value !== null) ? quota : null;
}

async function toApiError(response) {
  const body = await readJson(response);
  const options = {
    statusCode: response.status,
    code: body.code,
    response: body,
    requestId: response.headers.get('x-request-id'),
  };
  const message = body.message || `Gateway request failed (HTTP ${response.status}).`;

  if (response.status === 400) return new ValidationError(message, options);

  if (response.status === 429 || response.status === 503) {
    const retryOptions = {
      ...options,
      retryAfter: numericHeader(response.headers, 'retry-after'),
      quota: readQuota(response.headers),
    };
    return response.status === 429
      ? new RateLimitError(message, retryOptions)
      : new ServiceUnavailableError(message, retryOptions);
  }

  return new ApiError(message, options);
}

async function backoff(attempt) {
  const delay = Math.min(2000, 100 * 2 ** (attempt - 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

module.exports = { ApiClient };
