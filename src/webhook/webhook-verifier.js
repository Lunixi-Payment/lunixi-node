'use strict';

const crypto = require('node:crypto');
const { ConfigurationError } = require('../errors');

/**
 * Verifies inbound Lunixi webhooks.
 *
 * The `x-lunixi-signature` header is a comma-separated list of `scheme=value`
 * items. The only signature scheme is v2; the list form exists solely for the
 * 24h secret-rotation grace window, during which the gateway sends two items
 * (`v2=<newSecretHmac>,v2=<oldSecretHmac>`).
 *
 * v2 = hex HMAC-SHA256(secret, `${eventId}.${timestamp}.${rawBody}`)
 *   - eventId   = x-lunixi-event-id header
 *   - timestamp = the EXACT string of x-lunixi-signature-timestamp (ISO 8601)
 *   - rawBody   = the exact raw request body bytes (UTF-8) — never parsed or
 *     re-serialized for signing.
 *
 * Verification: split the header on ',', trim, take the `v2=` items and
 * timing-safe compare each against the computed HMAC — valid if ANY matches.
 * A header without a v2 item ALWAYS fails (unknown schemes are ignored).
 *
 * FAIL-CLOSED: any discrepancy throws; never act on an unverified payload.
 */
class WebhookVerifier {
  /**
   * @param {string} secret
   * @param {{ toleranceSeconds?: number | null }} [options]
   *   toleranceSeconds: replay window (default 300). Pass null to disable the
   *   timestamp freshness check.
   */
  constructor(secret, options = {}) {
    if (typeof secret !== 'string' || secret.trim() === '') {
      throw new ConfigurationError('Webhook secret is required.');
    }
    this.secret = secret;
    this.toleranceSeconds = options.toleranceSeconds === undefined ? 300 : options.toleranceSeconds;
  }

  verify(rawBody, headers = {}) {
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    const timestamp = header(headers, 'x-lunixi-signature-timestamp');
    const signature = header(headers, 'x-lunixi-signature');
    const eventId = header(headers, 'x-lunixi-event-id');
    const eventType = header(headers, 'x-lunixi-event-type');

    if (!timestamp || !signature || !eventId) {
      throw new ConfigurationError('Missing webhook signature, timestamp or event id header.');
    }
    const ts = Date.parse(timestamp);
    if (this.toleranceSeconds !== null) {
      if (!Number.isFinite(ts)) throw new ConfigurationError('Webhook timestamp is not a valid date.');
      if (Math.abs(Date.now() - ts) > this.toleranceSeconds * 1000) {
        throw new ConfigurationError('Webhook timestamp is outside the tolerance window.');
      }
    }

    const v2Items = parseSignatureHeader(signature).filter((item) => item.scheme === 'v2');
    if (v2Items.length === 0) {
      throw new ConfigurationError('Webhook signature has no v2 item.');
    }

    // HMAC over the EXACT raw body string — no parse, no re-serialization.
    const expected = crypto.createHmac('sha256', this.secret)
      .update(`${eventId}.${timestamp}.${body}`)
      .digest('hex');
    const anyMatch = v2Items.some((item) => timingSafeEqual(expected, item.value));
    if (!anyMatch) throw new ConfigurationError('Webhook signature verification failed.');

    const envelope = JSON.parse(body);
    return {
      id: typeof envelope.id === 'string' && envelope.id ? envelope.id : eventId,
      type: typeof envelope.type === 'string' && envelope.type ? envelope.type : eventType,
      timestamp: ts,
      data: envelope && typeof envelope.data === 'object' && envelope.data !== null ? envelope.data : envelope,
      raw: envelope,
    };
  }
}

/**
 * Splits `v2=abc,v2=def` into `[{scheme:'v2',value:'abc'}, …]`. Unknown
 * schemes are carried through (and ignored by the caller) so new schemes can
 * be introduced without breaking old verifiers.
 */
function parseSignatureHeader(headerValue) {
  return String(headerValue)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return { scheme: '', value: part };
      return { scheme: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
    });
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return null;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { WebhookVerifier };
