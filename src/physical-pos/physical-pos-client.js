'use strict';

const { PHYSICAL_POS_REQUEST_FIELDS } = require('./physical-pos-values');
const {
  buildBody,
  buildQuery,
  pathId,
  newIdempotencyKey,
  idempotencyKeyOf,
  requireIdempotencyKey,
  unwrap,
  toPage,
  paginate,
  writeResult,
  send,
  paymentWrite,
} = require('./physical-pos-request');
const { parsePhysicalPosWebhookEvent } = require('./physical-pos-webhook');

const BASE = '/api/v1/physical-pos';

/**
 * Physical POS — payments on your card terminals, transactions, reports,
 * end-of-day runs and results (`/api/v1/physical-pos`, product PHYSICAL_POS).
 *
 * Every call is signed with your API key; the key decides the environment
 * (a TEST key can read but every payment write is 403
 * `physical_pos.environment.test_key_read_only`). Scopes: payment writes need
 * `physical_pos:payments`; reads need `physical_pos:view` or
 * `physical_pos:payments`.
 *
 * Card data is never sent: the card is read on the device. A request field
 * that looks like card data (`pan`, `cardNumber`, `cvv`, `expiry` …) or a card
 * number in `merchantReference`, an item name / tax group or a free-text
 * filter throws `PhysicalPosCardDataRejectedError` before anything is sent;
 * any other unknown field throws `ConfigurationError`.
 *
 * A payment write is asynchronous: the answer means "accepted", not "paid".
 * Follow the outcome with the `physical_pos.payment.*` webhooks or
 * `getPayment()`. Resolving a payment under manual review is done in the
 * panel only.
 *
 * Idempotency — store the key first, then call:
 *
 *     const key = PhysicalPosClient.newIdempotencyKey();
 *     await orders.save({ id: orderId, posKey: key });         // your storage
 *     try {
 *       await client.physicalPos.createPayment(request, key);
 *     } catch (error) {
 *       if (error instanceof PhysicalPosOutcomeUnknownError) {
 *         // the payment may exist: call again later with the SAME key
 *       }
 *     }
 *
 * A new key for the same payment can charge the card twice. For a SALE, also
 * send `merchantReference` with `allowDuplicateReference: false`: the gateway
 * then refuses a second sale while one with that reference is unresolved
 * (`physical_pos.payment.previous_outcome_unknown`).
 */
class PhysicalPosClient {
  constructor(api) {
    this.api = api;
  }

  /** A new `Idempotency-Key` (UUID v4). Store it with your order before you call. */
  static newIdempotencyKey() {
    return newIdempotencyKey();
  }

  /**
   * Starts a payment on a device: `SALE`, `PREAUTH_OPEN` or
   * `REFUND_UNMATCHED` (`POST /payments`). `target` is exactly one of
   * `{ deviceId }`, `{ vendorCode, serialNumber }` or `{ externalRef }`.
   *
   * `instrument` is `CARD` (default) or a provider-collected card such as
   * `MEAL_CARD`; for those send `interaction` (`INSTRUMENT_READ`: the device
   * reads the card, `CODE_DISPLAY`: the device shows the provider's QR / short
   * code) and, when the terminal has several provider rows,
   * `terminalProviderId` (`listTerminalProviders()` row id). Leave both out for
   * `CARD`.
   *
   * `idempotencyKey` is required (see the class note). Returns
   * `{ payment, replayed, statusCode, idempotencyKey }`: 202 with
   * `paymentStatus: NOT_STARTED` for a new payment, 200 with `replayed: true`
   * when the same key and body were sent before (the payment's current view).
   * Throws `PhysicalPosOutcomeUnknownError` when the outcome is unknown.
   */
  async createPayment(request, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey, 'a physical POS payment');
    const body = buildBody(request, PHYSICAL_POS_REQUEST_FIELDS.createPayment, 'createPayment request');
    return paymentWrite(this.api, `${BASE}/payments`, body, key, (replayed) => (replayed ? 200 : 202));
  }

  /**
   * Reverses an approved payment (`POST /payments/{paymentId}/reversals`):
   * `VOID`, `REFUND` (by amount or by `items: [{ lineNo, quantityMilli }]`),
   * `PREAUTH_CLOSE` or `PREAUTH_CANCEL`. The reversal is a new child payment
   * (`originalPaymentId` = `paymentId`) followed like any payment.
   * `idempotencyKey` is required; same result and errors as `createPayment()`.
   */
  async createReversal(paymentId, request, idempotencyKey) {
    const id = pathId(paymentId, 'paymentId');
    const key = requireIdempotencyKey(idempotencyKey, 'a physical POS reversal');
    const body = buildBody(request, PHYSICAL_POS_REQUEST_FIELDS.createReversal, 'createReversal request');
    return paymentWrite(this.api, `${BASE}/payments/${id}/reversals`, body, key, (replayed) => (replayed ? 200 : 202));
  }

  /**
   * Cancels a payment before its start command reaches the device
   * (`POST /payments/{paymentId}/cancel`, 200). Read `payment.paymentStatus`:
   * only `EXPIRED` with `statusReason: MERCHANT_CANCELLED_BEFORE_DISPATCH`
   * means it was cancelled; a payment already in a final state comes back
   * unchanged with `replayed: true`. To undo an approved sale use a reversal.
   * Cancelling is idempotent, so the key is optional (a UUID when omitted).
   */
  async cancelPayment(paymentId, idempotencyKey = null) {
    const id = pathId(paymentId, 'paymentId');
    const key = idempotencyKeyOf(idempotencyKey);
    return paymentWrite(this.api, `${BASE}/payments/${id}/cancel`, {}, key, () => 200);
  }

  /** One payment with its items and refund items (`GET /payments/{paymentId}`). */
  async getPayment(paymentId) {
    const data = unwrap(await send(this.api, 'GET', `${BASE}/payments/${pathId(paymentId, 'paymentId')}`));
    return data?.payment ?? data;
  }

  /**
   * Payments, newest first (`GET /payments`). Roots and reversals are in one
   * list; `items` and `refundItems` are empty here (read one payment for them).
   * `merchantReference` finds a payment after an unknown outcome.
   */
  async listPayments(filters = {}) {
    return toPage(await send(this.api, 'GET', `${BASE}/payments`, null, { query: buildQuery(filters, 'listPayments') }));
  }

  async *iteratePayments(filters = {}) {
    yield* paginate((page) => this.listPayments(page), filters);
  }

  /** Transaction trees (root payment + its reversals), newest first (`GET /transactions`). */
  async listTransactions(filters = {}) {
    return toPage(await send(this.api, 'GET', `${BASE}/transactions`, null, { query: buildQuery(filters, 'listTransactions') }));
  }

  async *iterateTransactions(filters = {}) {
    yield* paginate((page) => this.listTransactions(page), filters);
  }

  /** The tree of a root or child payment with its timeline (`GET /transactions/{paymentId}`). */
  async getTransaction(paymentId) {
    const data = unwrap(await send(this.api, 'GET', `${BASE}/transactions/${pathId(paymentId, 'paymentId')}`));
    return data?.transaction ?? data;
  }

  /** Payments with an unknown outcome or under manual review (`GET /transactions/ambiguous`). */
  async listAmbiguousPayments(filters = {}) {
    return toPage(await send(this.api, 'GET', `${BASE}/transactions/ambiguous`, null, {
      query: buildQuery(filters, 'listAmbiguousPayments'),
    }));
  }

  async *iterateAmbiguousPayments(filters = {}) {
    yield* paginate((page) => this.listAmbiguousPayments(page), filters);
  }

  /**
   * Sale / refund / void counts and amounts with net per currency
   * (`GET /reports/sales-summary`). `dateFrom` / `dateTo` are business days
   * (`YYYY-MM-DD`, Europe/Istanbul); `groupBy` DAY, STORE, DEVICE or INSTRUMENT.
   */
  async getSalesSummary(filters = {}) {
    return unwrap(await send(this.api, 'GET', `${BASE}/reports/sales-summary`, null, { query: buildQuery(filters, 'getSalesSummary') }));
  }

  /** Tax breakdown with refunds and voids deducted (`GET /reports/tax-summary`). */
  async getTaxSummary(filters = {}) {
    return unwrap(await send(this.api, 'GET', `${BASE}/reports/tax-summary`, null, { query: buildQuery(filters, 'getTaxSummary') }));
  }

  /** End-of-day results per bank line, with the reported / system / difference totals (`GET /settlements`). */
  async listSettlements(filters = {}) {
    return toPage(await send(this.api, 'GET', `${BASE}/settlements`, null, { query: buildQuery(filters, 'listSettlements') }));
  }

  async *iterateSettlements(filters = {}) {
    yield* paginate((page) => this.listSettlements(page), filters);
  }

  /**
   * Starts end-of-day (batch close) on a device
   * (`POST /devices/{deviceId}/settlement`, `physical_pos:payments`). End-of-day
   * cannot be undone. The answer means "accepted": the device reports the
   * result later — follow it with `getSettlementRun()` or `listSettlements()`.
   *
   * Returns `{ run, replayed, statusCode (202 new / 200 replay), idempotencyKey }`.
   * The gateway requires an `Idempotency-Key`: pass the one you stored, or
   * `null` for a new UUID (returned as `idempotencyKey`; after an unknown
   * outcome call again with it). A TEST key is refused with 403
   * `physical_pos.environment.test_key_read_only`.
   */
  async startSettlement(deviceId, idempotencyKey = null) {
    const id = pathId(deviceId, 'deviceId');
    const key = idempotencyKeyOf(idempotencyKey);
    const response = await send(this.api, 'POST', `${BASE}/devices/${id}/settlement`, {}, { idempotencyKey: key });
    return writeResult(response, key, (replayed) => (replayed ? 200 : 202));
  }

  /**
   * End-of-day runs started by Lunixi (manual and scheduled), newest first
   * (`GET /settlement-runs`). Filters: `deviceId`, `source` (MANUAL_API,
   * MANUAL_PANEL, SCHEDULED), `runStatus` (PENDING, STARTED, SKIPPED, FAILED),
   * `createdFrom` / `createdTo`, `includeTotal`.
   */
  async listSettlementRuns(filters = {}) {
    return toPage(await send(this.api, 'GET', `${BASE}/settlement-runs`, null, { query: buildQuery(filters, 'listSettlementRuns') }));
  }

  async *iterateSettlementRuns(filters = {}) {
    yield* paginate((page) => this.listSettlementRuns(page), filters);
  }

  /** One end-of-day run with its command status and result state (`GET /settlement-runs/{runId}`). */
  async getSettlementRun(runId) {
    const data = unwrap(await send(this.api, 'GET', `${BASE}/settlement-runs/${pathId(runId, 'runId')}`));
    return data?.run ?? data;
  }

  /**
   * Verifies (signature, event id, timestamp) and reads a `physical_pos.*`
   * webhook from the raw body, the headers and your webhook secret (or a
   * `WebhookVerifier`). See `parsePhysicalPosWebhookEvent`.
   */
  static parseWebhookEvent(rawBody, headers, secretOrVerifier, options = {}) {
    return parsePhysicalPosWebhookEvent(rawBody, headers, secretOrVerifier, options);
  }
}

module.exports = { PhysicalPosClient };
