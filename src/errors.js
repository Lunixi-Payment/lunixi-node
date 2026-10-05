'use strict';

class LunixiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options.cause;
  }
}

class ConfigurationError extends LunixiError {}
class SignatureError extends LunixiError {}

class ApiError extends LunixiError {
  constructor(message, options = {}) {
    super(message, options);
    this.statusCode = options.statusCode || 0;
    this.code = options.code || null;
    this.response = options.response || null;
    this.requestId = options.requestId || null;
  }
}

/**
 * 400 — the gateway rejected the request body.
 *
 * Fraud raises this for a declared value outside its dictionary: `channel`
 * outside the standalone-declarable set, an `integrationMode` other than
 * `standalone`, or a `productContext` reserved for platform senders. `code`
 * carries the gateway error code.
 */
class ValidationError extends ApiError {}

/**
 * 429 — quota exceeded.
 *
 * `retryAfter` is the `Retry-After` value in seconds when the gateway sent one.
 * `quota` carries the `X-RateLimit-*` / `X-Quota-*` headers when present; the
 * gateway omits them rather than guessing, so every field may be null.
 */
class RateLimitError extends ApiError {
  constructor(message, options = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter ?? null;
    this.quota = options.quota || null;
  }
}

/** 503 — the service (or its quota backend) is unavailable. Carries `Retry-After` when sent. */
class ServiceUnavailableError extends ApiError {
  constructor(message, options = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter ?? null;
    this.quota = options.quota || null;
  }
}

module.exports = {
  LunixiError,
  ConfigurationError,
  SignatureError,
  ApiError,
  ValidationError,
  RateLimitError,
  ServiceUnavailableError,
};
