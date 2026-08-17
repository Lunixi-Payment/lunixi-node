'use strict';

const crypto = require('node:crypto');
const { ConfigurationError } = require('../errors');

class WebhookVerifier {
  constructor(secret, options = {}) {
    if (typeof secret !== 'string' || secret.trim() === '') {
      throw new ConfigurationError('Webhook secret is required.');
    }
    this.secret = secret;
    this.toleranceSeconds = options.toleranceSeconds || 300;
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
    if (!Number.isFinite(ts)) throw new ConfigurationError('Webhook timestamp is not a valid date.');
    if (Math.abs(Date.now() - ts) > this.toleranceSeconds * 1000) {
      throw new ConfigurationError('Webhook timestamp is outside the tolerance window.');
    }

    const payloadHash = WebhookVerifier.payloadHash(body);
    const expected = 'sha256=' + crypto.createHmac('sha256', this.secret)
      .update(`${eventId}.${timestamp}.${payloadHash}`)
      .digest('hex');
    if (!timingSafeEqual(expected, signature)) throw new ConfigurationError('Webhook signature verification failed.');

    const envelope = JSON.parse(body);
    return {
      id: typeof envelope.id === 'string' && envelope.id ? envelope.id : eventId,
      type: typeof envelope.type === 'string' && envelope.type ? envelope.type : eventType,
      timestamp,
      data: envelope && typeof envelope.data === 'object' && envelope.data !== null ? envelope.data : envelope,
      raw: envelope,
    };
  }

  static stableStringify(rawBody) {
    let decoded;
    try {
      decoded = JSON.parse(String(rawBody || ''));
    } catch (error) {
      throw new ConfigurationError('Webhook body is not valid JSON.', { cause: error });
    }
    return JSON.stringify(sortValue(decoded));
  }

  static payloadHash(rawBody) {
    return crypto.createHash('sha256').update(WebhookVerifier.stableStringify(rawBody)).digest('hex');
  }
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

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

module.exports = { WebhookVerifier };
