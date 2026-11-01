'use strict';

const { validateResponseMoney } = require('./physical-pos-money');
const { ConfigurationError } = require('../errors');
const { WebhookVerifier } = require('../webhook/webhook-verifier');

const PREFIX = 'physical_pos.';
const DEVICE_SALE = 'physical_pos.payment.device_sale';

/**
 * Verifies and reads a physical POS webhook. There is no way in without the
 * signature: pass the exact raw request body, the request headers and your
 * webhook secret (or a configured `WebhookVerifier`). The signature, event id
 * and timestamp are checked by the existing `WebhookVerifier`; any mismatch
 * throws before the body is read.
 *
 * The event body is the envelope's `data`; a `payloadJson` envelope (object or
 * JSON string) is read the same way. The event type comes from the signed
 * body only. Amounts in the payload are strings in minor units (`"4500"`),
 * matching the HTTP API.
 *
 * Delivery order is not guaranteed and an event can arrive more than once:
 * deduplicate by `id` and ignore an event whose `historySeq` is not greater
 * than the last one you applied for the same `data.paymentId`.
 *
 * `original` is the reversal's original payment `{ paymentId, origin }`
 * (`origin`: `API` or `DEVICE_DIRECT`), `null` on a root payment.
 * `isDeviceSale` is `true` for `physical_pos.payment.device_sale`, a sale
 * made directly on the device (`data.origin`, `data.deviceOccurredAt`).
 *
 * @param {string|Buffer} rawBody exact bytes received (not re-serialised JSON)
 * @param {Record<string, string|string[]|undefined>} headers request headers
 * @param {string|WebhookVerifier} secretOrVerifier webhook secret or a verifier
 * @param {{ toleranceSeconds?: number|null }} [options] verifier options when a secret is passed
 */
function parsePhysicalPosWebhookEvent(rawBody, headers, secretOrVerifier, options = {}) {
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
    throw new ConfigurationError('Pass the exact raw webhook body (string or Buffer) together with its headers and your webhook secret.');
  }
  const verifier = secretOrVerifier instanceof WebhookVerifier ? secretOrVerifier : new WebhookVerifier(secretOrVerifier, options);
  let verified;
  try {
    verified = verifier.verify(rawBody, headers || {});
  } catch (error) {
    if (error instanceof SyntaxError) throw new ConfigurationError('The physical POS webhook body is not valid JSON.');
    throw error;
  }
  const envelope = verified.raw;
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ConfigurationError('The physical POS webhook body is not an event envelope.');
  }
  const type = firstText(envelope.type, envelope.eventType);
  if (!type || !type.startsWith(PREFIX)) {
    throw new ConfigurationError(`Not a physical POS webhook event (type: ${type || 'missing'}).`);
  }
  const data = payloadOf(envelope);
  validateResponseMoney(data);
  return {
    id: firstText(envelope.id, envelope.eventId, verified.id),
    type,
    category: categoryOf(type),
    environment: firstText(envelope.environment),
    createdAt: firstText(envelope.createdAt, envelope.occurredAt, envelope.timestamp),
    historySeq: Number.isSafeInteger(data.historySeq) ? data.historySeq : null,
    original: originalOf(data),
    isDeviceSale: type === DEVICE_SALE,
    data,
    raw: envelope,
  };
}

function payloadOf(envelope) {
  if (isNonEmptyObject(envelope.data)) return envelope.data;
  let payload = envelope.payloadJson;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new ConfigurationError('The physical POS webhook payloadJson is not valid JSON.');
    }
  }
  if (isNonEmptyObject(payload)) return payload;
  throw new ConfigurationError('The physical POS webhook carries no event data (data / payloadJson).');
}

/**
 * The original payment of a reversal event: `{ paymentId, origin }` when
 * `data.original` carries both as non-empty strings (other keys are dropped);
 * otherwise `null` (a root payment, or a payload without it).
 */
function originalOf(data) {
  const original = data ? data.original : null;
  if (original === null || typeof original !== 'object' || Array.isArray(original)) return null;
  const paymentId = firstText(original.paymentId);
  const origin = firstText(original.origin);
  return paymentId && origin ? { paymentId, origin } : null;
}

function categoryOf(type) {
  if (type.startsWith('physical_pos.payment.')) return 'payment';
  if (type.startsWith('physical_pos.fiscal_document.')) return 'fiscal_document';
  return 'other';
}

function isNonEmptyObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function firstText(...values) {
  for (const value of values) if (typeof value === 'string' && value !== '') return value;
  return null;
}

module.exports = { parsePhysicalPosWebhookEvent, originalOf };
