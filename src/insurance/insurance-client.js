'use strict';

const { ConfigurationError } = require('../errors');
const { BasketItem } = require('../payment/dto');
const {
  InsurancePremiumCollectedBy,
  InsuranceReferenceKind,
  InsuranceLeadStatus,
  INSURANCE_QUOTE_FIELDS,
  INSURANCE_LEAD_FIELDS,
  INSURANCE_PRODUCT_SEARCH_FIELDS,
  INSURANCE_ORDER_FIELDS,
  INSURANCE_CONSENT_FIELDS,
  INSURANCE_EXTERNAL_PAYMENT_FIELDS,
  INSURANCE_EXTERNAL_REFUND_FIELDS,
  INSURANCE_FILTERS,
  INSURANCE_IDEMPOTENCY_KEY_PATTERN,
  INSURANCE_MAX_LIMIT,
  INSURANCE_MAX_CONTEXT_ITEMS,
  INSURANCE_LEAD_NOTE_MAX_LENGTH,
} = require('./insurance-values');

const BASE = '/api/v1/insurance';
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_MAX_LENGTH = 512;
const TEXT_MAX_LENGTH = 128;
const PDF_ACCEPT = 'application/pdf, application/json';
const CSV_ACCEPT = 'text/csv, application/json';
const TRUNCATED_LINE = /^# truncated=true orderCap=(\d+) nextCursor=(\S+)\s*$/;
const ABORTED_LINE = /^# export-aborted=true\s*$/;
const REFERENCE_KINDS = Object.values(InsuranceReferenceKind);
const LEAD_STATUSES = Object.values(InsuranceLeadStatus);

/**
 * Insurance — offer, sell and service insurance for your basket items, and
 * submit leads for the types sold by request only (`/api/v1/insurance`,
 * product INSURANCE_SERVICE).
 *
 * Every call is signed (`stepUp`), reads included; an unsigned request is 401
 * `AUTH_HEADERS_MISSING` and a key without the product is 403
 * `PRODUCT_NOT_ENABLED`. The key decides the environment (TEST or LIVE).
 *
 * Responses are the envelope's `data`, unwrapped. List calls return
 * `{ items, hasMore, nextCursor }`. Request fields and query filters are
 * checked before anything is sent (the gateway rejects an unknown field with
 * 400); the field rules of an insurance type's own object (`insured`,
 * `tickets` …) are not repeated here — a violation comes back as 422
 * `insurance.validation.invalid` with every `details.errors[{ field, reason }]`
 * at once. Amounts are integers in minor units.
 */
class InsuranceClient {
  constructor(api) {
    this.api = api;
  }

  /**
   * Insurance types offered for a payment's basket, read from the items sent
   * when the payment was created (`GET /products`). Without `paymentIntentId`
   * it lists the insurance types sold without a basket item (`basketItemIds`
   * empty). An empty list means insurance is not offered; it is not an error.
   * Each product says what the items already fill in (`prefill`,
   * `providedFields` masked), whether a quote needs nothing more
   * (`quoteReady`) and which `insuranceData` could not be used
   * (`insuranceDataIssues`).
   */
  async listProducts(filters) {
    const query = buildQuery(filters, 'listProducts');
    requireFilters(query, ['currency'], 'listProducts');
    return unwrap(await read(this.api, '/products', query));
  }

  /**
   * Insurance types offered for basket items before the payment exists
   * (`POST /products`, read-only). Send the items you will send in the
   * payment: `{ currency, insuranceType?, context: { items } }`.
   */
  async searchProducts(request) {
    const body = plainObject(request, 'searchProducts request');
    assertKeys(body, INSURANCE_PRODUCT_SEARCH_FIELDS, 'searchProducts request');
    const payload = { currency: requireCurrency(body.currency, 'currency'), context: contextOf(body.context, true) };
    if (present(body.insuranceType)) payload.insuranceType = requireText(body.insuranceType, 'insuranceType');
    return unwrap(await this.api.request('POST', `${BASE}/products`, payload, { stepUp: true }));
  }

  /** Lunixi reference codes of one kind (`InsuranceReferenceKind`), for the type fields that take a code. */
  async listReferenceValues(kind, filters = {}) {
    return toPage(await read(this.api, `/reference/${encodeURIComponent(referenceKind(kind))}`, buildQuery(filters, 'listReferenceValues')));
  }

  async *iterateReferenceValues(kind, filters = {}) {
    referenceKind(kind);
    yield* paginate((page) => this.listReferenceValues(kind, page), filters);
  }

  /**
   * Prices an insurance type (HTTP 201). The basket is either a payment's
   * recorded basket (`paymentIntentId`) or the items you will send in the
   * payment (`context.items`), not both. Send neither for an insurance type
   * sold without a basket item: the insured value is then in the type object.
   * Every option of the answer has its own `quoteId`, `terms` and `expiresAt`;
   * an insurance company the request could not be priced with is in
   * `excludedOptions` (with the missing field paths) and does not stop the
   * other options. When no company can be priced, the call fails (422
   * `insurance.validation.invalid` with every missing field).
   *
   * The quote starts from the items' `insuranceContext` and `insuranceData`
   * (recorded with the payment, or sent in `context.items` for this call
   * only); a field in the request wins. With `paymentIntentId` the type fields
   * may be partial or left out (`InsuranceProduct.quoteReady`).
   *
   * The `Idempotency-Key` is optional and only correlates traces: every call is
   * a new, time-limited price.
   */
  async createQuote(request, idempotencyKey = null) {
    const body = plainObject(request, 'createQuote request');
    assertKeys(body, INSURANCE_QUOTE_FIELDS, 'createQuote request');
    const hasPayment = present(body.paymentIntentId);
    const hasItems = present(body.context);
    if (hasPayment && hasItems) {
      throw new ConfigurationError(
        "Send the basket either as 'paymentIntentId' (a payment that exists) or as 'context.items' (before the payment), not both. Send neither for an insurance type sold without a basket item.",
      );
    }
    const payload = compact({
      ...body,
      insuranceType: requireText(body.insuranceType, 'insuranceType'),
      currency: requireCurrency(body.currency, 'currency'),
      paymentIntentId: hasPayment ? requireUuid(body.paymentIntentId, 'paymentIntentId') : undefined,
      context: hasItems ? contextOf(body.context, true) : undefined,
      merchantOrderId: present(body.merchantOrderId) ? requireText(body.merchantOrderId, 'merchantOrderId', TEXT_MAX_LENGTH) : undefined,
    });
    return unwrap(await this.api.request('POST', `${BASE}/quotes`, payload, {
      stepUp: true,
      idempotencyKey: optionalIdempotencyKey(idempotencyKey),
    }));
  }

  /** One quote option. 404 `insurance.quote.not_found` for an unknown or another merchant's quote. */
  async getQuote(quoteId) {
    return unwrap(await read(this.api, `/quotes/${encodeURIComponent(requireText(quoteId, 'quoteId'))}`));
  }

  /**
   * Turns a quote option into an order (HTTP 201) and records the buyer's
   * consent. No provider call and no money movement. The `Idempotency-Key` is
   * required: the same key with the same body returns the recorded order, with
   * another body 409 `insurance.idempotency.conflict`.
   *
   * `consent` carries the option's `terms` back unchanged plus the moment the
   * buyer accepted them; `InsuranceClient.consentFromQuote()` builds it.
   */
  async createOrder(request, idempotencyKey) {
    const body = plainObject(request, 'createOrder request');
    assertKeys(body, INSURANCE_ORDER_FIELDS, 'createOrder request');
    const consent = plainObject(body.consent, 'consent');
    assertKeys(consent, INSURANCE_CONSENT_FIELDS, 'consent');
    const payload = compact({
      quoteId: requireText(body.quoteId, 'quoteId'),
      merchantOrderId: present(body.merchantOrderId) ? requireText(body.merchantOrderId, 'merchantOrderId', TEXT_MAX_LENGTH) : undefined,
      consent: {
        termsVersion: requireText(consent.termsVersion, 'consent.termsVersion'),
        termsSha256: requireText(consent.termsSha256, 'consent.termsSha256'),
        acceptedAt: isoTime(consent.acceptedAt, 'consent.acceptedAt'),
      },
    });
    return unwrap(await this.api.request('POST', `${BASE}/orders`, payload, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('insurance order create', idempotencyKey),
    }));
  }

  /** Your insurance orders, newest first. */
  async listOrders(filters = {}) {
    return toPage(await read(this.api, '/orders', buildQuery(filters, 'listOrders')));
  }

  async *iterateOrders(filters = {}) {
    yield* paginate((page) => this.listOrders(page), filters);
  }

  /** 404 `insurance.order.not_found` for an unknown or another merchant's order. */
  async getOrder(orderId) {
    return unwrap(await read(this.api, orderPath(orderId)));
  }

  /**
   * Binds an order to the Lunixi payment that collects its premium. When you
   * collect it (`premiumCollectedBy: MERCHANT`) the payment basket must hold the
   * premium item (`InsuranceClient.premiumBasketItem()`); when the provider
   * collects it, it must not. Binding the same payment again returns the order.
   * The `Idempotency-Key` is optional.
   */
  async bindPayment(orderId, paymentIntentId, idempotencyKey = null) {
    return unwrap(await this.api.request('POST', `${BASE}${orderPath(orderId)}/bind-payment`, {
      paymentIntentId: requireUuid(paymentIntentId, 'paymentIntentId'),
    }, { stepUp: true, idempotencyKey: optionalIdempotencyKey(idempotencyKey) }));
  }

  /**
   * Records a premium you collected outside Lunixi:
   * `{ externalPaymentId, paidAmount, paidCurrency, paidAt, paymentProvider? }`.
   * `paidAmount` and `paidCurrency` must equal the order's premium. The
   * `Idempotency-Key` is required; repeating the same `externalPaymentId`
   * returns the order.
   */
  async confirmPayment(orderId, payment, idempotencyKey) {
    const body = plainObject(payment, 'payment');
    assertKeys(body, INSURANCE_EXTERNAL_PAYMENT_FIELDS, 'payment');
    const payload = compact({
      externalPaymentId: requireText(body.externalPaymentId, 'payment.externalPaymentId', TEXT_MAX_LENGTH),
      paidAmount: requirePositiveMinor(body.paidAmount, 'payment.paidAmount'),
      paidCurrency: requireCurrency(body.paidCurrency, 'payment.paidCurrency'),
      paidAt: isoTime(body.paidAt, 'payment.paidAt'),
      paymentProvider: present(body.paymentProvider) ? requireText(body.paymentProvider, 'payment.paymentProvider', 64) : undefined,
    });
    return unwrap(await this.api.request('POST', `${BASE}${orderPath(orderId)}/confirm-payment`, { payment: payload }, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('insurance payment confirmation', idempotencyKey),
    }));
  }

  /**
   * Requests the policy of an order whose premium you collected outside Lunixi
   * (`policyStatus: PENDING`; the result arrives by webhook). With a Lunixi
   * payment the policy is requested on its own once the premium is collected.
   * 412 `insurance.premium.not_captured` before the premium is collected.
   */
  async issuePolicy(orderId, idempotencyKey) {
    return unwrap(await this.api.request('POST', `${BASE}${orderPath(orderId)}/issue-policy`, null, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('insurance policy issue', idempotencyKey),
    }));
  }

  /**
   * Opens a cancellation at the provider for every issued policy of the order
   * (`policyStatus: CANCEL_PENDING`; `insurance.policy.cancelled` confirms it).
   * Cancelling does not refund the premium: call `refundPremium()` after it.
   */
  async cancelOrder(orderId, idempotencyKey) {
    return unwrap(await this.api.request('POST', `${BASE}${orderPath(orderId)}/cancel`, null, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('insurance order cancel', idempotencyKey),
    }));
  }

  /**
   * Refunds the premium. With a Lunixi payment, leave `externalRefund` out: the
   * premium is refunded from that payment (`refundStatus: PENDING`, then
   * `insurance.refund.completed`). For a premium collected outside Lunixi, send
   * the refund you made: `{ externalRefund: { externalRefundId, refundedAt } }`.
   * An in-force policy must be cancelled first (409, `policy_active`).
   */
  async refundPremium(orderId, options = {}, idempotencyKey) {
    const body = plainObject(options, 'refundPremium options');
    assertKeys(body, ['externalRefund'], 'refundPremium options');
    const payload = {};
    if (present(body.externalRefund)) {
      const refund = plainObject(body.externalRefund, 'externalRefund');
      assertKeys(refund, INSURANCE_EXTERNAL_REFUND_FIELDS, 'externalRefund');
      payload.externalRefund = {
        externalRefundId: requireText(refund.externalRefundId, 'externalRefund.externalRefundId', TEXT_MAX_LENGTH),
        refundedAt: isoTime(refund.refundedAt, 'externalRefund.refundedAt'),
      };
    }
    return unwrap(await this.api.request('POST', `${BASE}${orderPath(orderId)}/refund-premium`, payload, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('insurance premium refund', idempotencyKey),
    }));
  }

  /**
   * Submits a lead (HTTP 201) for an insurance type sold by request only: the
   * provider gives no quote, so there is no premium, order, policy or
   * document. The lead is sent to the provider with your own connection in
   * this call. `policyholder`, the type object and an optional `note` follow
   * the type's lead schema; a violation is 422 `insurance.validation.invalid`
   * with every `details.errors[{ field, reason }]` at once.
   *
   * The answer's `status` is `SUBMITTED` (the provider received it, followed by
   * the `insurance.lead.submitted` webhook) or `UNKNOWN` (the outcome is not
   * known; the lead is not sent again). A provider refusal is 422
   * `insurance.lead.rejected`; a type or connection without leads is 412
   * `insurance.type.not_available`.
   *
   * The `Idempotency-Key` is required: the same key with the same body returns
   * the same lead, with another body 409 `insurance.idempotency.conflict`.
   */
  async createLead(request, idempotencyKey) {
    const key = requireIdempotencyKey('insurance lead submit', idempotencyKey);
    const body = plainObject(request, 'createLead request');
    assertKeys(body, INSURANCE_LEAD_FIELDS, 'createLead request');
    const payload = compact({
      ...body,
      insuranceType: requireText(body.insuranceType, 'insuranceType', 64),
      note: present(body.note) ? leadNote(body.note) : undefined,
    });
    return unwrap(await this.api.request('POST', `${BASE}/leads`, payload, { stepUp: true, idempotencyKey: key }));
  }

  /** Your leads, newest first. Personal data is masked in `requestMasked`. */
  async listLeads(filters = {}) {
    return toPage(await read(this.api, '/leads', buildQuery(filters, 'listLeads')));
  }

  async *iterateLeads(filters = {}) {
    yield* paginate((page) => this.listLeads(page), filters);
  }

  /** 404 `insurance.lead.not_found` for an unknown or another merchant's lead. */
  async getLead(leadId) {
    return unwrap(await read(this.api, `/leads/${encodeURIComponent(requireText(leadId, 'leadId'))}`));
  }

  /**
   * The policy PDF as `{ contentType, data: Buffer }`. It is read from the
   * provider on every call and is available while the policy is in force
   * (`ISSUED`, `CANCEL_PENDING`); 503 `insurance.document.unavailable` is
   * temporary — retry later.
   */
  async getPolicyDocument(policyId) {
    return policyFile(this.api, policyId, 'document');
  }

  /**
   * The provider's receipt for the policy premium, as `{ contentType, data:
   * Buffer }`. Only for products that issue one; otherwise 412
   * `insurance.document.not_supported`. Same availability as
   * `getPolicyDocument()`.
   */
  async getPolicyReceipt(policyId) {
    return policyFile(this.api, policyId, 'receipt');
  }

  /**
   * The provider's certificate of the policy (for example the Green Card of
   * `MOTOR_GREEN_CARD`), as `{ contentType, data: Buffer }`. Only for products
   * that issue one; otherwise 412 `insurance.document.not_supported`. Same
   * availability as `getPolicyDocument()`.
   */
  async getPolicyCertificate(policyId) {
    return policyFile(this.api, policyId, 'certificate');
  }

  /**
   * Reconciliation totals grouped by provider connection, currency and
   * `premiumCollectedBy`. `from` (inclusive) and `to` (exclusive) are required,
   * on the order creation time, a `Date` or an ISO-8601 string with a time zone,
   * at most 366 days apart.
   */
  async getReconciliationSummary(filters) {
    const query = buildQuery(filters, 'getReconciliationSummary');
    requireFilters(query, ['from', 'to'], 'getReconciliationSummary');
    return unwrap(await read(this.api, '/reconciliation/summary', query));
  }

  /** The orders and policies behind the summary for the same filter, newest first. */
  async listReconciliationOrders(filters) {
    const query = buildQuery(filters, 'listReconciliationOrders');
    requireFilters(query, ['from', 'to'], 'listReconciliationOrders');
    return toPage(await read(this.api, '/reconciliation/orders', query));
  }

  async *iterateReconciliationOrders(filters) {
    yield* paginate((page) => this.listReconciliationOrders(page), filters);
  }

  /**
   * The reconciliation report as CSV (UTF-8 with BOM, one line per policy,
   * amounts in minor units): `{ contentType, data: Buffer, truncated,
   * nextCursor, aborted }`. A file holds at most 20000 orders; when it was cut,
   * `truncated` is true and `nextCursor` continues it (pass it as `cursor`).
   * `aborted` is true when the file ends with the gateway's abort line: it is
   * incomplete, request it again.
   */
  async exportReconciliation(filters) {
    const query = buildQuery(filters, 'exportReconciliation');
    requireFilters(query, ['from', 'to'], 'exportReconciliation');
    const file = await this.api.request('GET', `${BASE}/reconciliation/export`, null, {
      stepUp: true,
      binary: true,
      accept: CSV_ACCEPT,
      query,
    });
    return { ...file, ...exportTrailer(file.data) };
  }

  /**
   * `consent` for `createOrder()`: the quote option's `terms` unchanged and the
   * moment the buyer accepted them (a `Date` or an ISO-8601 string with a time
   * zone, not in the future).
   */
  static consentFromQuote(option, acceptedAt) {
    const terms = plainObject(option, 'quote option').terms;
    if (!terms || typeof terms !== 'object') {
      throw new ConfigurationError("The quote option has no 'terms': pass an option returned by createQuote() or getQuote().");
    }
    return {
      termsVersion: requireText(terms.version, 'terms.version'),
      termsSha256: requireText(terms.sha256, 'terms.sha256'),
      acceptedAt: isoTime(acceptedAt, 'acceptedAt'),
    };
  }

  /**
   * The premium basket item for a payment that collects the premium of an
   * order (`premiumCollectedBy: MERCHANT`): `id` = `orderId`, `itemType:
   * VIRTUAL`, `price` = `premiumAmount`. Add it to the payment's basket next to
   * the insured items and add the premium to the payment `amount`; for
   * insurance sold without a basket item it can be the only item. It carries
   * no insurance field. A `PROVIDER` order must not have one.
   */
  static premiumBasketItem(order, { name, category1, category2 } = {}) {
    const source = plainObject(order, 'order');
    if (source.premiumCollectedBy !== InsurancePremiumCollectedBy.MERCHANT) {
      throw new ConfigurationError(
        'Only an order whose premium you collect (premiumCollectedBy MERCHANT) has a premium basket item.',
      );
    }
    return new BasketItem(compact({
      id: requireText(source.orderId, 'order.orderId'),
      price: requirePositiveMinor(source.premiumAmount, 'order.premiumAmount'),
      name: requireText(name, 'name'),
      category1: requireText(category1, 'category1'),
      category2: present(category2) ? requireText(category2, 'category2') : undefined,
      itemType: BasketItem.TYPE_VIRTUAL,
    }));
  }
}

/** A policy file (`document`, `receipt`, `certificate`): PDF bytes, the JSON envelope only on an error. */
function policyFile(api, policyId, file) {
  return api.request('GET', `${BASE}/policies/${encodeURIComponent(requireText(policyId, 'policyId'))}/${file}`, null, {
    stepUp: true,
    binary: true,
    accept: PDF_ACCEPT,
  });
}

/** The lead `note` is free text sent as given (not trimmed), at most 1000 characters. */
function leadNote(value) {
  if (typeof value !== 'string') throw new ConfigurationError("'note' must be a string.");
  if ([...value].length > INSURANCE_LEAD_NOTE_MAX_LENGTH) {
    throw new ConfigurationError(`'note' must be at most ${INSURANCE_LEAD_NOTE_MAX_LENGTH} characters.`);
  }
  return value;
}

/** Every insurance route is behind SignatureGuard: reads are signed too. */
function read(api, path, query) {
  const options = { stepUp: true };
  if (query && Object.keys(query).length > 0) options.query = query;
  return api.request('GET', `${BASE}${path}`, null, options);
}

function buildQuery(filters, route) {
  if (filters === null || filters === undefined || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new ConfigurationError('Insurance filters must be an object.');
  }
  const allowed = INSURANCE_FILTERS[route];
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown insurance filter(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}. The gateway rejects unknown query fields with 400.`,
    );
  }
  const query = {};
  for (const key of allowed) {
    if (!present(filters[key])) continue;
    query[key] = filterValue(key, filters[key]);
  }
  return query;
}

function filterValue(key, value) {
  switch (key) {
    case 'limit':
      if (!Number.isInteger(value) || value < 1 || value > INSURANCE_MAX_LIMIT) {
        throw new ConfigurationError(`'limit' must be an integer from 1 to ${INSURANCE_MAX_LIMIT}.`);
      }
      return value;
    case 'cursor':
      if (typeof value !== 'string' || value.length > CURSOR_MAX_LENGTH) {
        throw new ConfigurationError("'cursor' must be the nextCursor of the previous page, passed back unchanged.");
      }
      return value;
    case 'currency':
      return requireCurrency(value, key);
    case 'paymentIntentId':
    case 'connectionId':
      return requireUuid(value, key);
    case 'from':
    case 'to':
      return isoTime(value, key);
    case 'insuranceType':
    case 'parentCode':
      return requireText(value, key, 64);
    case 'merchantOrderId':
      return requireText(value, key, TEXT_MAX_LENGTH);
    case 'status':
      if (!LEAD_STATUSES.includes(value)) {
        throw new ConfigurationError(`'status' must be one of ${LEAD_STATUSES.join(', ')}.`);
      }
      return value;
    default:
      throw new ConfigurationError(`Unknown insurance filter '${key}'.`);
  }
}

function requireFilters(query, required, route) {
  const missing = required.filter((key) => query[key] === undefined);
  if (missing.length > 0) {
    throw new ConfigurationError(`${route} requires ${missing.map((key) => `'${key}'`).join(' and ')}.`);
  }
}

function referenceKind(kind) {
  if (!REFERENCE_KINDS.includes(kind)) {
    throw new ConfigurationError(`Reference kind must be one of ${REFERENCE_KINDS.join(', ')}.`);
  }
  return kind;
}

/** `context: { items }` — the same basket items the payment carries (1–100, `BasketItem` or plain objects). */
function contextOf(value, required) {
  if (!present(value)) {
    if (required) throw new ConfigurationError("'context.items' is required.");
    return undefined;
  }
  const context = plainObject(value, 'context');
  assertKeys(context, ['items'], 'context');
  if (!Array.isArray(context.items) || context.items.length < 1 || context.items.length > INSURANCE_MAX_CONTEXT_ITEMS) {
    throw new ConfigurationError(`'context.items' must hold 1 to ${INSURANCE_MAX_CONTEXT_ITEMS} basket items.`);
  }
  return { items: context.items.map(toPlain) };
}

function optionalIdempotencyKey(key) {
  if (key === null || key === undefined || key === '') return null;
  return assertIdempotencyKeyFormat(String(key).trim());
}

function requireIdempotencyKey(operation, key) {
  const value = typeof key === 'string' ? key.trim() : '';
  if (!value) {
    throw new ConfigurationError(`A stable Idempotency-Key is required for ${operation}. Reuse the same key when retrying the same operation.`);
  }
  return assertIdempotencyKeyFormat(value);
}

function assertIdempotencyKeyFormat(value) {
  if (!INSURANCE_IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ConfigurationError('Idempotency-Key must be 8-200 printable ASCII characters without spaces.');
  }
  return value;
}

function plainObject(value, field) {
  const plain = toPlain(value);
  if (plain === null || typeof plain !== 'object' || Array.isArray(plain)) {
    throw new ConfigurationError(`${field} must be an object.`);
  }
  return plain;
}

function assertKeys(object, allowed, field) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown ${field} field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}. The gateway rejects unknown fields with 400.`,
    );
  }
}

function requireText(value, field, maxLength = null) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`${field} is required.`);
  }
  const text = value.trim();
  if (maxLength !== null && text.length > maxLength) {
    throw new ConfigurationError(`${field} must be at most ${maxLength} characters.`);
  }
  return text;
}

function requireCurrency(value, field) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!CURRENCY_PATTERN.test(currency)) throw new ConfigurationError(`'${field}' must be an ISO 4217 code such as TRY.`);
  return currency;
}

function requireUuid(value, field) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!UUID_PATTERN.test(id)) throw new ConfigurationError(`'${field}' must be a Lunixi id (UUID).`);
  return id;
}

function requirePositiveMinor(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigurationError(`'${field}' must be an integer of at least 1 in minor units (4900 = 49.00 TRY).`);
  }
  return value;
}

/** A `Date` or an ISO-8601 string with a time zone; a value without a zone is rejected by the gateway (422). */
function isoTime(value, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ConfigurationError(`'${field}' is an invalid Date.`);
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new ConfigurationError(`'${field}' must be a Date or an ISO-8601 string with a time zone.`);
}

function exportTrailer(data) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : '';
  const lines = text.split(/\r?\n/).filter((line) => line !== '');
  const last = lines.length > 0 ? lines[lines.length - 1] : '';
  const truncated = TRUNCATED_LINE.exec(last);
  return {
    truncated: truncated !== null,
    nextCursor: truncated ? truncated[2] : null,
    aborted: ABORTED_LINE.test(last),
  };
}

async function* paginate(fetchPage, filters) {
  let cursor = filters?.cursor ?? undefined;
  for (;;) {
    const page = await fetchPage({ ...filters, cursor });
    for (const item of page.items) yield item;
    if (!page.hasMore || !page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

function orderPath(orderId) {
  return `/orders/${encodeURIComponent(requireText(orderId, 'orderId'))}`;
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function toPlain(value) {
  if (value && typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

function compact(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

function unwrap(response) {
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}

/**
 * Reads a list envelope: rows are `data.items`; paging is the envelope's
 * top-level `pageInfo` (a copy inside `data` is read only as a fallback).
 */
function toPage(response) {
  const payload = unwrap(response);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pageInfo = response?.pageInfo || payload?.pageInfo || {};
  const nextCursor = typeof pageInfo.nextCursor === 'string' && pageInfo.nextCursor !== '' ? pageInfo.nextCursor : null;
  return { items, hasMore: pageInfo.hasMore === true && nextCursor !== null, nextCursor };
}

module.exports = { InsuranceClient };
