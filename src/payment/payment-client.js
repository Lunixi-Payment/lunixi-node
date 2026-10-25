'use strict';

const { ConfigurationError, ValidationError } = require('../errors');
const { toPlain, requirePreauth, assertNoRemovedAmountFields } = require('./dto');
const {
  DIRECT_METHOD_PAYMENT_FIELDS,
  CARD_ONLY_FIELDS,
  PAYMENT_ACTION_CONFIRM_FIELDS,
  METHOD_BLOCK_FIELDS,
  PaymentMethod,
  normalizePaymentMethod,
  listPaymentMethodsQuery,
  blockNameOf,
  requireMethodFields,
} = require('./payment-method-values');
const {
  assertPromissoryNotePlan,
  assertIntentPromissoryNote,
  requireSerialNumbers,
  requireDocumentLocale,
} = require('./promissory-note-values');
const {
  SPLIT_PAYMENT_IN_PROGRESS_STATUSES,
  assertSplitPaymentPayload,
  requireSplitIdempotencyKey,
  requireSplitPaymentId,
  splitRefundBody,
  listSplitPaymentsQuery,
} = require('./split-payment-values');

const BASE = '/api/v1/payments';

class PaymentClient {
  constructor(api) {
    this.api = api;
  }

  /**
   * `POST /payments/intents`. `amount` is the only amount field (the basket
   * total in minor units); a raw body with `price` / `paidPrice` throws
   * `ConfigurationError` before sending.
   */
  async createIntent(request, idempotencyKey = null) {
    const body = toPlain(request);
    assertNoRemovedAmountFields(body);
    if (body.promissoryNote !== undefined && body.promissoryNote !== null) {
      assertIntentPromissoryNote(body.promissoryNote, body.amount);
    }
    return this.api.request('POST', `${BASE}/intents`, body, {
      stepUp: true,
      idempotencyKey,
    });
  }

  /**
   * `POST /payments/marketplace/intents`: the intent body plus `sellers[]`
   * (`{ subDealerId, amountMinor, scenario? }`, `amountMinor` a digit string) and
   * `multiSellerPolicy`. The sellers' `amountMinor` values must add up to
   * `amount`; the gateway refuses any other total with 400.
   */
  async createMarketplaceIntent(request, idempotencyKey = null) {
    const body = toPlain(request);
    assertNoRemovedAmountFields(body);
    return this.api.request('POST', `${BASE}/marketplace/intents`, body, {
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

  /**
   * Starts a payment with any payment method from the merchant server
   * (`POST /payments/direct/payment`). Build the body with
   * `DirectMethodPaymentRequest`. `idempotencyKey` is required: reuse the same
   * key when retrying the same payment.
   *
   * This is the only server-side card charge: `withCard(card)`, plus
   * `withForce3D(true)` for 3D Secure (the former direct 2D/3D card endpoints
   * were removed).
   *
   * The gateway envelope comes back as it is: `data` holds `paymentId`,
   * `orderId`, `status`, `paymentMethod`, `providerCode` and, when the buyer must
   * act, `action` (HTTP 202). A declined payment is a 400 and throws
   * `ValidationError` whose `response.data` carries the same fields.
   *
   * On a method with `providerSelectionMode: PLATFORM` a request without
   * `providerCode` lets the platform pick the provider; when none of the
   * connected providers can take the payment the gateway answers 422
   * `payment.provider.none_eligible` (`details.candidates[]`) and nothing is
   * charged.
   */
  async directMethodPayment(request, idempotencyKey = null) {
    const body = toPlain(request);
    assertDirectMethodPaymentPayload(body);
    return this.api.request('POST', `${BASE}/direct/payment`, body, {
      stepUp: true,
      idempotencyKey: requireIdempotencyKey('direct method payment', idempotencyKey),
    });
  }

  /**
   * Completes the open action of a payment
   * (`POST /payments/{paymentId}/actions/{actionId}/confirm`): the buyer's
   * one-time code (`otp`), the agreement consent (`consentAccepted`) when
   * `action.consent.required` is true, or the values an `INPUT` action asks for
   * (`fields`). It does not start a new charge; repeating the same confirm
   * returns the recorded result. A rejected code is a 422 with
   * `details.attemptsRemaining`; the action stays open.
   */
  async confirmPaymentAction(paymentId, actionId, input = {}) {
    return this.api.request('POST', actionPath(paymentId, actionId, 'confirm'), confirmBody(input), { stepUp: true });
  }

  /**
   * Sends a new one-time code (`POST /payments/{paymentId}/actions/{actionId}/resend`).
   * The previous action is closed; confirm with the new `data.action.id`.
   */
  async resendPaymentAction(paymentId, actionId) {
    return this.api.request('POST', actionPath(paymentId, actionId, 'resend'), null, { stepUp: true });
  }

  /**
   * The payment methods open for your account (`GET /payments/methods`): for
   * each method its `blockName`, `providerSelection`, `providerSelectionMode`
   * (who picks the provider when you call the API), `preauth` support, limits,
   * `splitEligible` / `splitBehavior` (split payments) and providers with the
   * `inputFields` to send in the method block.
   *
   * Methods and providers come in the order set in your form settings (the
   * platform's default order when you set none). A provider turned off only in
   * the checkout form stays in this list and can be used through the API.
   *
   * `{ paymentMethod }` lists that method only (`QR` is sent as `QR_CODE`); a
   * method that is not open for the account gives `{ methods: [] }`. An unknown
   * code is a 400 `payment.method.unknown`.
   */
  async listPaymentMethods(options = undefined) {
    const query = listPaymentMethodsQuery(options);
    return this.api.request('GET', `${BASE}/methods`, null, query ? { stepUp: true, query } : { stepUp: true });
  }

  /**
   * The notes of a Senetle Ödeme payment
   * (`GET /payments/{paymentId}/promissory-notes`, signed): `documentType`,
   * `rowSerialNumber`, `totalAmount` and per note `serialNumber`, `sequence`,
   * `amount` (minor units), `dueDate` and `status` (`ISSUED`, `PAID`,
   * `PROTESTED`, `CANCELLED`). Statuses are refreshed from the provider
   * periodically; changes also arrive as `payment.promissory_note.*` webhooks.
   * A payment without notes (or of another merchant) is a 404
   * `payment.promissory_note.not_found`.
   */
  async getPromissoryNotes(paymentId) {
    return this.api.request('GET', promissoryNotesPath(paymentId), null, { stepUp: true });
  }

  /**
   * Cancels notes at the provider
   * (`POST /payments/{paymentId}/promissory-notes/cancel`, signed). Without
   * `serialNumbers` every open note is cancelled. The answer is the note list
   * plus `cancelResults[]` per note (`CANCELLED`, `ALREADY_CLOSED`,
   * `NOT_CANCELLABLE` for a collected note, `FAILED`) with a Lunixi
   * `errorCode` (`PromissoryNoteCancelErrorCode`: `provider_unavailable` is
   * temporary, `cancel_rejected` permanent; never the provider's code). The payment stays
   * `CAPTURED`: no funds moved through the platform, so there is nothing to
   * refund.
   */
  async cancelPromissoryNotes(paymentId, serialNumbers = null, idempotencyKey = null) {
    const body = serialNumbers === null || serialNumbers === undefined
      ? null
      : { serialNumbers: requireSerialNumbers(serialNumbers) };
    return this.api.request('POST', `${promissoryNotesPath(paymentId)}/cancel`, body, {
      stepUp: true,
      idempotencyKey,
    });
  }

  /**
   * The printable notes as a PDF, one note per page
   * (`GET /payments/{paymentId}/promissory-notes/document`, signed). Built from the
   * provider's current data and not stored: download it when you need it.
   * Returns `{ contentType: 'application/pdf', data: Buffer }`. A 503
   * `payment.promissory_note.document_unavailable` means the provider could
   * not be reached; try again later.
   */
  async downloadPromissoryNoteDocument(paymentId, locale = null) {
    const query = locale === null || locale === undefined ? undefined : { locale: requireDocumentLocale(locale) };
    return this.api.request('GET', `${promissoryNotesPath(paymentId)}/document`, null, {
      stepUp: true,
      binary: true,
      accept: PDF_ACCEPT,
      query,
    });
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

  /**
   * `GET /payments`. A split payment is one row (its main payment, `split.role`
   * `PARENT`); `{ includeLegs: true }` also returns each leg as a row
   * (`split.role` `LEG`). Rows of other payments carry no `split`.
   */
  list(filters = {}) {
    const query = {};
    for (const key of ['page', 'limit', 'status', 'customerId']) {
      if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') query[key] = filters[key];
    }
    if (filters.includeLegs !== undefined && filters.includeLegs !== null) {
      if (typeof filters.includeLegs !== 'boolean') {
        throw new ConfigurationError(`includeLegs must be a boolean; got ${JSON.stringify(filters.includeLegs)}.`);
      }
      query.includeLegs = String(filters.includeLegs);
    }
    return this.api.request('GET', BASE, null, { query });
  }

  /**
   * Starts a split payment, or continues it (`POST /payments/split`). Build the
   * body with `SplitPaymentRequest`. `idempotencyKey` is required and is the
   * identity of the split payment: after a step (an OTP confirmed, the buyer
   * back from 3D Secure) send the SAME request with the SAME key. No new
   * payment is created; the payment continues where it stopped and the next
   * non-card leg starts with its block from this request.
   *
   * The answer carries `splitPaymentId`, `status`, `steps` (the order the
   * platform set) and `pendingStep` (what the payment waits for):
   *   - `THREE_DS`: send the buyer to `pendingStep.redirectPath`;
   *   - `ACTION`: complete it with `confirmPaymentAction(pendingStep.paymentId,
   *     pendingStep.actionId, …)` (`pendingStep.action` has the details when the
   *     action was opened by this call), then call this method again;
   *   - `START_METHOD`: call this method again;
   *   - `RESULT_PENDING`, `CREDIT_APPROVAL`: read the payment later with
   *     `getSplitPayment()`; the result also arrives by webhook.
   *
   * While the payment is running (`SPLIT_PAYMENT_IN_PROGRESS_STATUSES`) the
   * gateway answers with HTTP 400 and the status as `code`; that answer is
   * returned here, not thrown. `COMPLETED` is HTTP 200. A failed payment
   * (`VOIDED`, `FAILED`, `COMPENSATING`, `RECONCILIATION_REQUIRED`) throws
   * `ValidationError` whose `response.data` carries the same fields. Rule
   * violations are 422 `split_pay.validation.*` (`SplitPayErrorCode`).
   */
  async createSplitPayment(request, idempotencyKey = null) {
    const body = toPlain(request);
    assertSplitPaymentPayload(body);
    const key = requireSplitIdempotencyKey('split payment', idempotencyKey);
    try {
      return await this.api.request('POST', `${BASE}/split`, body, { stepUp: true, idempotencyKey: key });
    } catch (error) {
      const running = runningSplitResponse(error);
      if (running) return running;
      throw error;
    }
  }

  /**
   * One split payment with its legs (`GET /payments/split/{splitPaymentId}`):
   * per leg `paymentMethod`, `providerCode`, `legAmount`, `installmentCount`,
   * `chargeAmount`, `capturedAmount`, `refundedAmount`, `refundState`,
   * `dispute`; for the main payment `aggregate`, `refund` and `dispute`. The card
   * token is never returned. Another merchant's split is a 404.
   */
  getSplitPayment(splitPaymentId) {
    return this.api.request('GET', `${BASE}/split/${encodeURIComponent(requireSplitPaymentId(splitPaymentId))}`);
  }

  /**
   * Split payments, newest first (`GET /payments/split`). Filters: `status`
   * and `currency` (a value or a list), `createdFrom`, `createdTo`, `orderId`,
   * `ownerRef`, `limit` (1–100) and `after` (the `pageInfo.endCursor` of the
   * previous page).
   */
  listSplitPayments(filters = {}) {
    const query = listSplitPaymentsQuery(filters);
    return this.api.request('GET', query ? `${BASE}/split?${query}` : `${BASE}/split`);
  }

  /**
   * Refunds the main payment of a completed split payment
   * (`POST /payments/split/{splitPaymentId}/refund`). The amount is spread over
   * the legs: card legs first (partial refunds allowed), then the other
   * refundable legs (each in full); a non-reversible leg is never refunded.
   * `idempotencyKey` is required; retry with the same key.
   *
   * `data` gives the result per leg and `refundableAmount` /
   * `nonRefundableAmount`. When some legs could not be refunded the gateway
   * answers `split_pay.refund.incomplete` (thrown as `ValidationError`,
   * `response.data` has the per-leg result); retry with the same key. The main
   * payment of a Checkout Form split is refunded with `refund(paymentId, …)`,
   * which spreads the amount the same way.
   */
  async refundSplitPayment(splitPaymentId, amount, reason = null, idempotencyKey = null) {
    const id = requireSplitPaymentId(splitPaymentId);
    const body = splitRefundBody(amount, reason);
    return this.api.request('POST', `${BASE}/split/${encodeURIComponent(id)}/refund`, body, {
      stepUp: true,
      idempotencyKey: requireSplitIdempotencyKey('split payment refund', idempotencyKey),
    });
  }

  failoverRecoveryAnalytics(filters = {}) {
    return this.api.request('GET', `${BASE}/analytics/failover-recovery`, null, { query: filters });
  }

  providerCredentialAnalytics(credentialId, filters = {}) {
    return this.api.request('GET', `${BASE}/analytics/provider-credentials/${encodeURIComponent(credentialId)}`, null, { query: filters });
  }
}

const PDF_ACCEPT = 'application/pdf, application/json';

function promissoryNotesPath(paymentId) {
  if (typeof paymentId !== 'string' || paymentId.trim() === '') {
    throw new ConfigurationError('paymentId is required (data.paymentId of the promissory-note payment).');
  }
  return `${BASE}/${encodeURIComponent(paymentId)}/promissory-notes`;
}

/**
 * The gateway answers a running split payment with HTTP 400 and the split
 * status as `code` (the payment has not failed). That answer is the result of
 * the call, so it is returned instead of thrown. Only a body that is the split
 * payment itself (`data.splitPaymentId`) and a running status qualify.
 */
function runningSplitResponse(error) {
  if (!(error instanceof ValidationError) || error.statusCode !== 400) return null;
  const body = error.response;
  if (!body || !SPLIT_PAYMENT_IN_PROGRESS_STATUSES.includes(body.code)) return null;
  const data = body.data;
  if (!data || typeof data !== 'object' || typeof data.splitPaymentId !== 'string' || data.splitPaymentId === '') return null;
  return body;
}

function requireIdempotencyKey(operation, key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    throw new ConfigurationError(`A stable Idempotency-Key is required for ${operation}. Reuse the same key when retrying the same merchant operation.`);
  }
  return trimmed;
}

function assertDirectMethodPaymentPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConfigurationError('A direct method payment needs a body. Use DirectMethodPaymentRequest to build it.');
  }
  assertNoRemovedAmountFields(payload);
  const unknown = Object.keys(payload).filter((key) => !DIRECT_METHOD_PAYMENT_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`Unknown direct method payment field(s): ${unknown.join(', ')}.`);
  }
  for (const field of ['paymentMethod', 'amount', 'currency', 'orderId']) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new ConfigurationError(`Direct method payments require '${field}'. Use DirectMethodPaymentRequest to build the request.`);
    }
  }
  const method = normalizePaymentMethod(payload.paymentMethod);
  const ownBlock = blockNameOf(method);
  const given = (field) => payload[field] !== undefined && payload[field] !== null;
  if (method !== PaymentMethod.CARD) {
    const cardField = CARD_ONLY_FIELDS.find(given);
    if (cardField) throw new ConfigurationError(`${cardField} can only be sent with paymentMethod CARD.`);
  }
  const otherBlock = METHOD_BLOCK_FIELDS.find((field) => field !== ownBlock && given(field));
  if (otherBlock) {
    throw new ConfigurationError(`paymentMethod ${method} takes only the '${ownBlock}' block; '${otherBlock}' must not be sent.`);
  }
  if ((ownBlock === 'card' || METHOD_BLOCK_FIELDS.includes(ownBlock)) && !given(ownBlock)) {
    throw new ConfigurationError(`paymentMethod ${method} requires the '${ownBlock}' block.`);
  }
  if (method === PaymentMethod.PROMISSORY_NOTE) assertPromissoryNotePlan(payload.promissoryNote, payload.amount);
  if (Object.prototype.hasOwnProperty.call(payload, 'preauth')) requirePreauth(payload.preauth);
  if (Object.prototype.hasOwnProperty.call(payload, 'force3D') && typeof payload.force3D !== 'boolean') {
    throw new ConfigurationError(`force3D must be a boolean; got ${JSON.stringify(payload.force3D)}.`);
  }
}

function actionPath(paymentId, actionId, operation) {
  for (const [name, value] of [['paymentId', paymentId], ['actionId', actionId]]) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ConfigurationError(`${name} is required (from the payment response: data.paymentId and data.action.id).`);
    }
  }
  return `${BASE}/${encodeURIComponent(paymentId)}/actions/${encodeURIComponent(actionId)}/${operation}`;
}

function confirmBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigurationError('confirmPaymentAction input must be an object: { otp, consentAccepted, fields }.');
  }
  const unknown = Object.keys(input).filter((key) => !PAYMENT_ACTION_CONFIRM_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`Unknown confirm field(s): ${unknown.join(', ')}. A merchant server confirms with its signature and sends only ${PAYMENT_ACTION_CONFIRM_FIELDS.join(', ')}.`);
  }
  const body = {};
  if (input.otp !== undefined && input.otp !== null) {
    if (typeof input.otp !== 'string' || !/^[0-9]{1,16}$/.test(input.otp)) {
      throw new ConfigurationError('otp must be the code the buyer entered, as a string of digits.');
    }
    body.otp = input.otp;
  }
  if (input.consentAccepted !== undefined && input.consentAccepted !== null) {
    if (typeof input.consentAccepted !== 'boolean') {
      throw new ConfigurationError(`consentAccepted must be a boolean; got ${JSON.stringify(input.consentAccepted)}.`);
    }
    body.consentAccepted = input.consentAccepted;
  }
  if (input.fields !== undefined && input.fields !== null) {
    body.fields = requireMethodFields(input.fields, 'fields');
  }
  if (Object.keys(body).length === 0) {
    throw new ConfigurationError('confirmPaymentAction needs otp, consentAccepted or fields.');
  }
  return body;
}

module.exports = { PaymentClient, requireIdempotencyKey, assertDirectMethodPaymentPayload };
