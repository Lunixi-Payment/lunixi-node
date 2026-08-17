'use strict';

const { ConfigurationError } = require('../errors');
const { toPlain } = require('./dto');

const BASE = '/api/v1/payments';

class PaymentClient {
  constructor(api) {
    this.api = api;
  }

  async createIntent(request, idempotencyKey = null) {
    return this.api.request('POST', `${BASE}/intents`, toPlain(request), {
      stepUp: true,
      idempotencyKey,
    });
  }

  async createMarketplaceIntent(request, idempotencyKey = null) {
    return this.api.request('POST', `${BASE}/marketplace/intents`, toPlain(request), {
      stepUp: true,
      idempotencyKey,
    });
  }

  async capture(intentId, amount = null, idempotencyKey = null) {
    const body = amount === null ? { paymentIntentId: intentId } : { paymentIntentId: intentId, amount };
    return this.api.request('POST', `${BASE}/${encodeURIComponent(intentId)}/capture`, body, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('capture', idempotencyKey),
    });
  }

  async refund(intentId, amount = null, reason = null, idempotencyKey = null) {
    const body = { paymentIntentId: intentId };
    if (amount !== null) body.amount = amount;
    if (reason) body.reason = reason;
    return this.api.request('POST', `${BASE}/${encodeURIComponent(intentId)}/refund`, body, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('refund', idempotencyKey),
    });
  }

  async void(intentId, idempotencyKey = null) {
    return this.api.request('POST', `${BASE}/${encodeURIComponent(intentId)}/void`, null, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('void', idempotencyKey),
    });
  }

  async chargeCard(payload, threeDS = false, idempotencyKey = null) {
    const body = toPlain(payload);
    assertDirectPaymentPayload(body);
    return this.api.request('POST', `${BASE}/direct/${threeDS ? '3d' : '2d'}`, body, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey(threeDS ? 'direct 3D payment' : 'direct 2D payment', idempotencyKey),
    });
  }

  chargeCard2d(request, idempotencyKey = null) {
    return this.chargeCard(request, false, idempotencyKey);
  }

  chargeCard3d(request, idempotencyKey = null) {
    return this.chargeCard(request, true, idempotencyKey);
  }

  binInfo(binOrPan) {
    return this.api.request('POST', '/api/v1/bin/info', { binOrPan });
  }

  installmentOptions(request) {
    return this.api.request('POST', '/api/v1/bin/installments', toPlain(request));
  }

  cardTaxonomy() {
    return this.api.request('GET', '/api/v1/bin/card-taxonomy');
  }

  storeCard(request, idempotencyKey = null) {
    return this.api.request('POST', `${BASE}/cards`, toPlain(request), {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('store card', idempotencyKey),
    });
  }

  listStoredCards(cardUserKey) {
    return this.api.request('GET', `${BASE}/cards`, null, { query: { cardUserKey } });
  }

  getStoredCard(storedCardToken) {
    return this.api.request('GET', `${BASE}/cards/${encodeURIComponent(storedCardToken)}`);
  }

  deactivateStoredCard(storedCardToken, idempotencyKey = null) {
    return this.api.request('DELETE', `${BASE}/cards/${encodeURIComponent(storedCardToken)}`, null, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('deactivate stored card', idempotencyKey),
    });
  }

  get(intentId) {
    return this.api.request('GET', `${BASE}/${encodeURIComponent(intentId)}`);
  }

  list(filters = {}) {
    const query = {};
    for (const key of ['page', 'limit', 'status', 'customerId']) {
      if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') query[key] = filters[key];
    }
    return this.api.request('GET', BASE, null, { query });
  }

  failoverRecoveryAnalytics(filters = {}) {
    return this.api.request('GET', `${BASE}/analytics/failover-recovery`, null, { query: filters });
  }

  providerCredentialAnalytics(credentialId, filters = {}) {
    return this.api.request('GET', `${BASE}/analytics/provider-credentials/${encodeURIComponent(credentialId)}`, null, { query: filters });
  }
}

function requireIdempotencyKey(operation, key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    throw new ConfigurationError(`A stable Idempotency-Key is required for ${operation}. Reuse the same key when retrying the same merchant operation.`);
  }
  return trimmed;
}

function assertDirectPaymentPayload(payload) {
  for (const field of ['paidPrice', 'currency', 'orderId', 'card', 'buyer', 'billingAddress', 'basketItems']) {
    if (!Object.prototype.hasOwnProperty.call(payload || {}, field)) {
      throw new ConfigurationError(`Direct payments require '${field}'. Use DirectPaymentRequest to build a complete payment request.`);
    }
  }
  for (const field of ['card', 'buyer', 'billingAddress']) {
    if (!payload[field] || typeof payload[field] !== 'object' || Array.isArray(payload[field]) || Object.keys(payload[field]).length === 0) {
      throw new ConfigurationError(`Direct payments require a non-empty '${field}' object.`);
    }
  }
  if (!Array.isArray(payload.basketItems) || payload.basketItems.length === 0) {
    throw new ConfigurationError('Direct payments require at least one basket item.');
  }
}

module.exports = { PaymentClient, requireIdempotencyKey, assertDirectPaymentPayload };
