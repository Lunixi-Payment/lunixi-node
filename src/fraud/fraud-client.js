'use strict';

const { ConfigurationError } = require('../errors');
const { toEvaluateBody } = require('./evaluate-request');

const BASE = '/api/v1/fraud';

/**
 * Reads the list envelope. `pageInfo` is a SIBLING of `data` in the gateway
 * envelope, not nested inside it.
 */
function toPage(response) {
  const data = Array.isArray(response?.data) ? response.data : [];
  const pageInfo = response?.pageInfo || {};
  const nextCursor = typeof pageInfo.nextCursor === 'string' && pageInfo.nextCursor !== ''
    ? pageInfo.nextCursor
    : null;
  return {
    items: data,
    hasMore: Boolean(pageInfo.hasMore),
    nextCursor,
    totalCount: typeof pageInfo.totalCount === 'number' ? pageInfo.totalCount : null,
  };
}

function unwrap(response) {
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}

/**
 * Transaction event ingest.
 *
 * These routes are authenticated by the per-request Ed25519 signature
 * (`stepUp`), not by the bearer token alone — the signature is what binds the
 * event to your merchant, so the body cannot claim a different one.
 */
class FraudEventsClient {
  constructor(api) {
    this.api = api;
  }

  /**
   * Records a single transaction event.
   *
   * Required: `eventId`, `subjectType`, `eventType`, `occurredAt`.
   * `merchantId` is stamped from the authenticated key and is never read from
   * the body, so a body value cannot claim a different merchant.
   *
   * @param {object} event
   * @param {string|null} idempotencyKey
   */
  async record(event, idempotencyKey = null) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new ConfigurationError('Fraud event must be an object.');
    }
    return unwrap(await this.api.request('POST', `${BASE}/events/transactions`, event, {
      stepUp: true,
      idempotencyKey,
    }));
  }

  /**
   * Records a batch of transaction events. Sent as a JSON array; the endpoint
   * also accepts `{ events: [...] }`.
   *
   * @param {object[]} events
   * @param {string|null} idempotencyKey
   */
  async recordBatch(events, idempotencyKey = null) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new ConfigurationError('Fraud event batch must be a non-empty array.');
    }
    return unwrap(await this.api.request('POST', `${BASE}/events/transactions/batch`, events, {
      stepUp: true,
      idempotencyKey,
    }));
  }
}

/** Persisted decision logs. */
class FraudDecisionsClient {
  constructor(api) {
    this.api = api;
  }

  /**
   * Lists decision logs. Paging is cursor-based: pass the previous page's
   * `nextCursor` back as `cursor`.
   *
   * @param {{paymentId?:string, decision?:string, integrationMode?:string,
   *          productContext?:string, limit?:number, cursor?:string}} filters
   */
  async list(filters = {}) {
    const query = {};
    for (const key of ['paymentId', 'decision', 'integrationMode', 'productContext', 'limit', 'cursor']) {
      const value = filters[key];
      if (value !== undefined && value !== null && value !== '') query[key] = value;
    }
    return toPage(await this.api.request('GET', `${BASE}/decision-logs`, null, { query }));
  }

  /** Returns one decision log by trace id. */
  async get(traceId) {
    if (typeof traceId !== 'string' || traceId.trim() === '') {
      throw new ConfigurationError('traceId is required.');
    }
    return unwrap(await this.api.request('GET', `${BASE}/decision-logs/${encodeURIComponent(traceId)}`));
  }

  /** The most recent decision for a payment intent, or null. */
  async latestForPayment(paymentId) {
    const page = await this.list({ paymentId, limit: 1 });
    return page.items[0] ?? null;
  }

  /**
   * Iterates every decision log matching the filters, following cursors.
   *
   * @param {object} filters
   */
  async *iterate(filters = {}) {
    let cursor = filters.cursor ?? undefined;
    for (;;) {
      const page = await this.list({ ...filters, cursor });
      for (const item of page.items) yield item;
      if (!page.hasMore || !page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }
}

class FraudClient {
  constructor(api) {
    this.api = api;
    this.events = new FraudEventsClient(api);
    this.decisions = new FraudDecisionsClient(api);
  }

  /**
   * Evaluates a transaction and returns the decision.
   *
   * Unknown fields are rejected locally — the gateway rejects them with 400.
   *
   * @param {object} request
   */
  async evaluate(request) {
    return unwrap(await this.api.request('POST', `${BASE}/decisions/evaluate`, toEvaluateBody(request)));
  }
}

module.exports = { FraudClient, FraudEventsClient, FraudDecisionsClient };
