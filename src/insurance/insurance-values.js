'use strict';

/**
 * Insurance (`/api/v1/insurance`, product INSURANCE_SERVICE) — value sets,
 * request fields and query filters.
 *
 * Source: nest-payment-gateway apps/api-gateway/src/insurance/
 * (api/insurance-api.controller.ts, dtos/insurance-api.dto.ts,
 * dtos/insurance-order.dto.ts, dtos/insurance-quote-payload.dto.ts,
 * dtos/insurance-lead.dto.ts, dtos/insurance-reconciliation.dto.ts,
 * mappers/insurance-json.mapper.ts, insurance.constants.ts),
 * apps/insurance-service/src/standards/ (insurance-order-status.ts,
 * insurance-reference-kinds.ts, insurance-lead-standards.ts) and
 * libs/proto/src/insurance-webhook.interface.ts.
 */

/** Who collects the premium. `PROVIDER` orders cannot be completed through this API yet. */
const InsurancePremiumCollectedBy = Object.freeze({ MERCHANT: 'MERCHANT', PROVIDER: 'PROVIDER' });

/** Status of a quote option (`status`). Only a `QUOTED` option that has not expired becomes an order. */
const InsuranceQuoteStatus = Object.freeze({
  REQUESTED: 'REQUESTED',
  QUOTED: 'QUOTED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
  ERROR: 'ERROR',
});

/**
 * The order's overall status. It is not stored: every read derives it from the
 * four axes, in this order — REFUNDED, CANCELLED, FAILED, ACTION_REQUIRED,
 * PROCESSING, PARTIALLY_ACTIVE, ACTIVE, CREATED.
 */
const InsuranceOrderStatus = Object.freeze({
  CREATED: 'CREATED',
  PROCESSING: 'PROCESSING',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  PARTIALLY_ACTIVE: 'PARTIALLY_ACTIVE',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
});

/** Premium collection axis (`collectionStatus`). */
const InsuranceCollectionStatus = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PENDING: 'PENDING',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  COLLECTED: 'COLLECTED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
});

/** Policy axis (`policyStatus`) of an order and of each of its policies. */
const InsurancePolicyStatus = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  PENDING: 'PENDING',
  PARTIALLY_ISSUED: 'PARTIALLY_ISSUED',
  ISSUED: 'ISSUED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_FINAL: 'FAILED_FINAL',
  UNKNOWN: 'UNKNOWN',
  CANCEL_PENDING: 'CANCEL_PENDING',
  CANCELLED: 'CANCELLED',
});

/** Premium refund axis (`refundStatus`). */
const InsuranceRefundStatus = Object.freeze({
  NONE: 'NONE',
  REQUIRED: 'REQUIRED',
  PENDING: 'PENDING',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
});

/** Policy document axis (`documentStatus`); it does not change the overall status. */
const InsuranceDocumentStatus = Object.freeze({
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  PENDING: 'PENDING',
  AVAILABLE: 'AVAILABLE',
  FAILED: 'FAILED',
});

/** How the premium of an order is paid (`paymentMode`). */
const InsurancePaymentMode = Object.freeze({
  LUNIXI_PAYMENT: 'LUNIXI_PAYMENT',
  EXTERNAL_PAYMENT: 'EXTERNAL_PAYMENT',
  NO_PAYMENT: 'NO_PAYMENT',
});

/** Where an order was created (`surface`). */
const InsuranceOrderSurface = Object.freeze({
  MERCHANT_API: 'MERCHANT_API',
  CHECKOUT_FORM: 'CHECKOUT_FORM',
  PANEL: 'PANEL',
});

/**
 * Status of a lead (`status`): what Lunixi knows about sending it to the
 * insurance provider. There is no later step: the provider does not report
 * back on a lead.
 * - `PENDING` — the provider call is still running.
 * - `SUBMITTED` — the provider received the lead (`insurance.lead.submitted`).
 * - `UNKNOWN` — the request reached the provider but the outcome is not known.
 *   It is never sent again; open a new lead with a new `Idempotency-Key` if needed.
 * - `FAILED` — the provider refused it or it never reached the provider (`errorCode`).
 */
const InsuranceLeadStatus = Object.freeze({
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  UNKNOWN: 'UNKNOWN',
  FAILED: 'FAILED',
});

/**
 * Lunixi reference code lists (`listReferenceValues(kind)`). DISTRICT,
 * DEVICE_MODEL, VEHICLE_MODEL, BANK_BRANCH and PET_BREED need `parentCode`
 * (province, brand, bank, `CAT` | `DOG`); COUNTRY, CITY and BANK take none.
 * National standards are the codes as they are (ISO 3166-1 alpha-2 country,
 * licence-plate province code `01`–`81`); the others are Lunixi codes.
 */
const InsuranceReferenceKind = Object.freeze({
  COUNTRY: 'COUNTRY',
  CITY: 'CITY',
  DISTRICT: 'DISTRICT',
  DEVICE_BRAND: 'DEVICE_BRAND',
  DEVICE_MODEL: 'DEVICE_MODEL',
  VEHICLE_BRAND: 'VEHICLE_BRAND',
  VEHICLE_MODEL: 'VEHICLE_MODEL',
  VEHICLE_TYPE: 'VEHICLE_TYPE',
  PRODUCT_CATEGORY: 'PRODUCT_CATEGORY',
  VEHICLE_USAGE: 'VEHICLE_USAGE',
  LIABILITY_LIMIT: 'LIABILITY_LIMIT',
  OCCUPATION: 'OCCUPATION',
  PET_BREED: 'PET_BREED',
  DWELLING_TYPE: 'DWELLING_TYPE',
  DWELLING_FLOOR: 'DWELLING_FLOOR',
  BANK: 'BANK',
  BANK_BRANCH: 'BANK_BRANCH',
  FINANCE_INSTITUTION: 'FINANCE_INSTITUTION',
  MEDICAL_PROCEDURE_COVER: 'MEDICAL_PROCEDURE_COVER',
});

/**
 * Insurance webhook event types (subscription `insurance.*`), delivered in the
 * same signed envelope as every Lunixi webhook and verified with
 * `WebhookVerifier`. Dedupe on the event id (`data.eventId` is the same value).
 */
const InsuranceEvents = Object.freeze({
  /** The order's policies were issued. */
  POLICY_ISSUED: 'insurance.policy.issued',
  /** The policy could not be issued or the premium was not collected; `data.errorCode` says why. */
  POLICY_FAILED: 'insurance.policy.failed',
  /** The collected premium has to be refunded; `data.errorCode` says why. */
  REFUND_REQUIRED: 'insurance.refund.required',
  /** A policy document can be downloaded (`policies[].documentUrl`). */
  POLICY_DOCUMENT_READY: 'insurance.policy.document_ready',
  /** The provider confirmed the cancellation. */
  POLICY_CANCELLED: 'insurance.policy.cancelled',
  /** The premium refund completed. */
  REFUND_COMPLETED: 'insurance.refund.completed',
  /** The insurance provider received a lead. `data` is a lead summary, not an order. */
  LEAD_SUBMITTED: 'insurance.lead.submitted',
});

/** Subscription pattern covering every insurance event. */
const INSURANCE_EVENT_PATTERN = 'insurance.*';

const INSURANCE_EVENT_TYPES = Object.freeze(Object.values(InsuranceEvents));

/** The type objects of the gateway's type body, one per insurance type (`InsuranceProduct.typeObject`). */
const INSURANCE_TYPE_OBJECT_FIELDS = Object.freeze([
  'tickets', 'stay', 'device', 'product', 'vehicle', 'trip', 'rental', 'instrument',
  'event', 'accident', 'procedure', 'pet', 'residence', 'abroadStay',
]);

/**
 * Top-level fields of `createQuote()` (the gateway answers any other with 400).
 * After the person fields come the type objects, one per insurance type
 * (`InsuranceProduct.typeObject`): `tickets` (a list) and the single objects
 * `stay`, `device`, `product`, `vehicle`, `trip`, `rental`, `instrument`,
 * `event`, `accident`, `procedure`, `pet`, `residence`, `abroadStay`.
 */
const INSURANCE_QUOTE_FIELDS = Object.freeze([
  'insuranceType', 'schemaVersion', 'currency', 'paymentIntentId', 'context',
  'merchantOrderId', 'policyholder', 'insured',
  ...INSURANCE_TYPE_OBJECT_FIELDS,
]);

/**
 * Top-level fields of `createLead()`: the type body of a quote without the
 * basket, currency and order fields, plus `shipment` and `company` (used only
 * by lead schemas) and the free `note`. A lead has no amount, currency,
 * basket item or payment.
 */
const INSURANCE_LEAD_FIELDS = Object.freeze([
  'insuranceType', 'schemaVersion', 'policyholder', 'insured',
  ...INSURANCE_TYPE_OBJECT_FIELDS,
  'shipment', 'company', 'note',
]);

/** Fields of `searchProducts()`. */
const INSURANCE_PRODUCT_SEARCH_FIELDS = Object.freeze(['currency', 'insuranceType', 'context']);

/** Fields of `createOrder()`. */
const INSURANCE_ORDER_FIELDS = Object.freeze(['quoteId', 'merchantOrderId', 'consent']);

/** Fields of `consent` (`createOrder()`). */
const INSURANCE_CONSENT_FIELDS = Object.freeze(['termsVersion', 'termsSha256', 'acceptedAt']);

/** Fields of `confirmPayment()` (a premium collected outside Lunixi). */
const INSURANCE_EXTERNAL_PAYMENT_FIELDS = Object.freeze([
  'externalPaymentId', 'paidAmount', 'paidCurrency', 'paidAt', 'paymentProvider',
]);

/** Fields of `externalRefund` (`refundPremium()` for a premium collected outside Lunixi). */
const INSURANCE_EXTERNAL_REFUND_FIELDS = Object.freeze(['externalRefundId', 'refundedAt']);

/** Query filters each read accepts (the gateway rejects any other with 400). */
const INSURANCE_FILTERS = Object.freeze({
  listProducts: Object.freeze(['currency', 'paymentIntentId', 'insuranceType']),
  listReferenceValues: Object.freeze(['parentCode', 'limit', 'cursor']),
  listOrders: Object.freeze(['limit', 'cursor', 'paymentIntentId', 'merchantOrderId']),
  getReconciliationSummary: Object.freeze(['from', 'to', 'connectionId', 'insuranceType', 'currency']),
  listReconciliationOrders: Object.freeze(['from', 'to', 'connectionId', 'insuranceType', 'currency', 'limit', 'cursor']),
  exportReconciliation: Object.freeze(['from', 'to', 'connectionId', 'insuranceType', 'currency', 'cursor']),
  listLeads: Object.freeze(['limit', 'cursor', 'insuranceType', 'status']),
});

/** `Idempotency-Key` accepted by the insurance routes: 8–200 printable ASCII characters, no spaces. */
const INSURANCE_IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,200}$/;

/** Largest page (`limit` 1–100). */
const INSURANCE_MAX_LIMIT = 100;
/** Most basket items one `context.items` may carry. */
const INSURANCE_MAX_CONTEXT_ITEMS = 100;
/** Orders in one reconciliation CSV file; a longer export ends with a continuation line. */
const INSURANCE_EXPORT_ORDER_CAP = 20000;
/** Longest lead `note` (characters). */
const INSURANCE_LEAD_NOTE_MAX_LENGTH = 1000;

module.exports = {
  InsurancePremiumCollectedBy,
  InsuranceQuoteStatus,
  InsuranceOrderStatus,
  InsuranceCollectionStatus,
  InsurancePolicyStatus,
  InsuranceRefundStatus,
  InsuranceDocumentStatus,
  InsurancePaymentMode,
  InsuranceOrderSurface,
  InsuranceLeadStatus,
  InsuranceReferenceKind,
  InsuranceEvents,
  INSURANCE_EVENT_PATTERN,
  INSURANCE_EVENT_TYPES,
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
  INSURANCE_EXPORT_ORDER_CAP,
  INSURANCE_LEAD_NOTE_MAX_LENGTH,
};
