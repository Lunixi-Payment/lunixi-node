'use strict';

const crypto = require('node:crypto');
const { ApiError } = require('./errors');
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

  async request(method, path, body = null, options = {}) {
    const upperMethod = method.toUpperCase();
    const signedPath = withQuery(path, options.query);
    const url = this.config.baseUrl + signedPath;
    const rawBody = body === null || body === undefined ? null : JSON.stringify(body);
    const idempotencyKey = options.idempotencyKey || null;
    const idempotent = upperMethod === 'GET' || upperMethod === 'HEAD' || Boolean(idempotencyKey);
    let reAuthed = false;

    for (let attempt = 1; ; attempt += 1) {
      const headers = await this.buildHeaders(upperMethod, signedPath, rawBody, Boolean(options.stepUp), idempotencyKey);

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

      if (response.ok) return readJson(response);

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

  async buildHeaders(method, signedPath, rawBody, stepUp, idempotencyKey) {
    const headers = {
      Accept: 'application/json',
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

function withQuery(path, query) {
  if (!query || Object.keys(query).length === 0) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
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

async function toApiError(response) {
  const body = await readJson(response);
  return new ApiError(body.message || `Gateway request failed (HTTP ${response.status}).`, {
    statusCode: response.status,
    code: body.code,
    response: body,
    requestId: response.headers.get('x-request-id'),
  });
}

async function backoff(attempt) {
  const delay = Math.min(2000, 100 * 2 ** (attempt - 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

module.exports = { ApiClient };
