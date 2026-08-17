'use strict';

const { ApiError } = require('../errors');
const crypto = require('node:crypto');
const {
  HEADER_KEY_ID,
  HEADER_DATE,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  buildCanonicalRequest,
} = require('./canonical-request');

class InMemoryTokenStore {
  constructor() {
    this.entry = null;
  }

  get() {
    if (!this.entry || this.entry.expiresAt <= Date.now()) return null;
    return this.entry.token;
  }

  set(token, ttlSeconds) {
    const skewMs = 30000;
    this.entry = {
      token,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000 - skewMs,
    };
  }

  clear() {
    this.entry = null;
  }
}

class TokenManager {
  constructor(config, signer, store = new InMemoryTokenStore()) {
    this.config = config;
    this.signer = signer;
    this.store = store;
  }

  async getToken() {
    const cached = this.store.get();
    if (cached) return cached;

    const headers = this.buildSignedTokenHeaders();
    const response = await this.config.fetch(this.config.baseUrl + this.config.authTokenPath, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const body = await readJson(response);
    if (!response.ok) {
      throw new ApiError(body.message || `Authentication failed (HTTP ${response.status}).`, {
        statusCode: response.status,
        code: body.code,
        response: body,
        requestId: response.headers.get('x-request-id'),
      });
    }

    const token = body.access_token || body.accessToken || body.token || body.data?.access_token || body.data?.accessToken;
    const ttl = Number(body.expires_in || body.expiresIn || body.data?.expires_in || body.data?.expiresIn || 3600);
    if (typeof token !== 'string' || token === '') {
      throw new ApiError('Authentication response did not include an access token.', { response: body });
    }

    this.store.set(token, ttl);
    return token;
  }

  invalidate() {
    this.store.clear();
  }

  buildSignedTokenHeaders() {
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const nonce = crypto.randomBytes(16).toString('hex');
    const canonical = buildCanonicalRequest('POST', this.config.authTokenPath, date, nonce);
    return {
      Accept: 'application/json',
      'User-Agent': this.config.userAgent,
      [HEADER_KEY_ID]: this.config.keyId,
      [HEADER_DATE]: date,
      [HEADER_NONCE]: nonce,
      [HEADER_SIGNATURE]: this.signer.sign(canonical),
    };
  }
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

module.exports = { TokenManager, InMemoryTokenStore };
