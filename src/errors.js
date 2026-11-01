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

/**
 * Physical POS — the request carried card data (`physical_pos.payment.card_data_rejected`).
 *
 * The API never takes a card number, expiry date, security code or track
 * data: the card is read on the device. `field` is the field path only
 * (`items[1].name`, `cardNumber`); the value is never echoed. `statusCode` is
 * 400 when the gateway rejected it and 0 when the SDK refused to send it.
 */
class PhysicalPosCardDataRejectedError extends ValidationError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || PhysicalPosCardDataRejectedError.CODE });
    this.field = options.field ?? null;
  }
}
PhysicalPosCardDataRejectedError.CODE = 'physical_pos.payment.card_data_rejected';

/**
 * Physical POS — 429 `RATE_LIMITED` (payment writes are limited per API key).
 * `retryAfter` is the `Retry-After` header in seconds, or
 * `details.retryAfterSeconds` when the header is missing.
 */
class PhysicalPosRateLimitError extends RateLimitError {}

/**
 * Physical POS — the outcome of a payment write (start, reversal, cancel) is
 * unknown; the payment may or may not exist. Raised when an attempt got no
 * HTTP answer (also while the body was read), a 2xx without a readable
 * payment, or a 5xx that does not say "not started" — and then for the whole
 * call, whatever a later attempt answered (a 429 or 409 included).
 *
 * Call again with the same `idempotencyKey` (safe: an existing payment comes
 * back with `replayed: true`), or look it up with
 * `listPayments({ merchantReference })`. A new key can start a second payment.
 * `cause` is the last error; `statusCode` / `code` are the last HTTP answer's
 * (0 / null when there was none); `attempts` is the number of attempts made.
 */
class PhysicalPosOutcomeUnknownError extends ApiError {
  constructor(message, options = {}) {
    super(message, options);
    this.idempotencyKey = options.idempotencyKey || null;
    this.retryAfter = options.retryAfter ?? null;
    this.attempts = options.attempts ?? null;
  }
}

/**
 * Physical POS — 409 `physical_pos.payment.void_after_settlement`: the payment
 * is already in a device end-of-day, so it can no longer be voided. Return the
 * amount with a `REFUND` reversal on the same payment (with a new
 * `Idempotency-Key`). `allowedOperation` is `details.allowedOperation`
 * (`REFUND`).
 */
class PhysicalPosVoidAfterSettlementError extends ApiError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || PhysicalPosVoidAfterSettlementError.CODE });
    this.allowedOperation = options.allowedOperation ?? null;
  }
}
PhysicalPosVoidAfterSettlementError.CODE = 'physical_pos.payment.void_after_settlement';

module.exports = {
  PhysicalPosCardDataRejectedError,
  PhysicalPosVoidAfterSettlementError,
  PhysicalPosRateLimitError,
  PhysicalPosOutcomeUnknownError,
  LunixiError,
  ConfigurationError,
  SignatureError,
  ApiError,
  ValidationError,
  RateLimitError,
  ServiceUnavailableError,
};
