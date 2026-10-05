'use strict';

const { ConfigurationError } = require('../errors');
const {
  TRANSACTION_REF_MAX_LENGTH,
  SUBJECT_ID_MAX_LENGTH,
  SUB_MERCHANT_REF_PATTERN,
} = require('./taxonomy');

/**
 * Fields the customer decision endpoint accepts.
 *
 * The gateway runs `forbidNonWhitelisted`, so an unknown key is a 400 from the
 * server. This list lets the SDK fail locally with the offending key name
 * instead, which is the difference between a readable error and a round trip.
 *
 * Deliberately absent:
 *   • `tenantId` — stamped from the access token; a body value is ignored, so
 *     accepting it here would imply the caller can choose their tenant.
 *   • engine-internal fields — they are not part of the customer surface.
 */
const ALLOWED_FIELDS = Object.freeze([
  'integrationMode',
  'productContext',
  'transactionRef',
  'channel',
  'surface',
  'stage',
  'operationKind',
  'authModeRequested',
  'authModeApplied',
  'subMerchantRef',
  'subjectType',
  'subjectId',
  'paymentRail',
  'transferDirection',
  'merchantGroupIds',
  'paymentId',
  'payment',
  'bankTransfer',
  'cryptoTransfer',
  'walletOperation',
  'billPayment',
  'loanApplication',
  'payout',
  'customer',
  'device',
  'session',
  'merchant',
  'mobileApp',
  'telemetry',
  'metadata',
  'identitySnapshot',
  'identityAssertion',
]);

const ALLOWED = new Set(ALLOWED_FIELDS);

function assertBoundedString(value, field, maxLength) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`Fraud request field '${field}' must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new ConfigurationError(
      `Fraud request field '${field}' must be at most ${maxLength} characters (got ${value.length}).`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigurationError(`Fraud request field '${field}' must not contain control characters.`);
  }
}

/**
 * Validates and normalizes an evaluate request.
 *
 * @param {object} request
 * @returns {object} a plain body ready to send
 */
function toEvaluateBody(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ConfigurationError('Fraud evaluate request must be an object.');
  }

  const unknown = Object.keys(request).filter((key) => !ALLOWED.has(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown fraud request field(s): ${unknown.join(', ')}. `
      + `The gateway rejects unknown fields with 400. Allowed: ${ALLOWED_FIELDS.join(', ')}.`,
    );
  }

  assertBoundedString(request.transactionRef, 'transactionRef', TRANSACTION_REF_MAX_LENGTH);
  assertBoundedString(request.subjectId, 'subjectId', SUBJECT_ID_MAX_LENGTH);

  if (request.subMerchantRef !== undefined && request.subMerchantRef !== null) {
    if (typeof request.subMerchantRef !== 'string' || !SUB_MERCHANT_REF_PATTERN.test(request.subMerchantRef)) {
      throw new ConfigurationError(
        "Fraud request field 'subMerchantRef' must match letters, digits and . _ : @ - (1-180 characters).",
      );
    }
  }

  const body = {};
  for (const key of ALLOWED_FIELDS) {
    const value = request[key];
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}

module.exports = { toEvaluateBody, ALLOWED_FIELDS };
