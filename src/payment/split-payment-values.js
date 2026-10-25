'use strict';

/**
 * Split payments (SplitPay): one payment funded by several legs. A leg is a
 * stored card or, when split payments with other methods are enabled in your
 * form settings, a non-card method (Faturana Yansıt, wallet, promissory note).
 *
 *   POST /api/v1/payments/split                          (create, and continue after a step)
 *   GET  /api/v1/payments/split/{splitPaymentId}         (detail with legs)
 *   GET  /api/v1/payments/split                          (list, forward cursor)
 *   POST /api/v1/payments/split/{splitPaymentId}/refund  (refund of the main payment)
 *
 * The platform sets the order of the legs (credit approval, card holds,
 * reversible charges, the non-reversible charge last) and returns it as
 * `steps`; neither you nor the buyer can change it. The field lists below are
 * the gateway DTO's (`forbidNonWhitelisted`), so the SDK, the Postman
 * collections (postman/test) and the PHP SDK are checked against one source.
 */

const { ConfigurationError } = require('../errors');
const {
  PaymentMethod,
  METHOD_BLOCK_FIELDS,
  normalizePaymentMethod,
  blockNameOf,
  requireProviderCode,
  requireMethodFields,
  isPlainObject,
} = require('./payment-method-values');
const { requireNoteCount } = require('./promissory-note-values');

/** How a method behaves in a split payment (`splitBehavior`); the platform orders the legs by it. */
const SplitBehavior = Object.freeze({
  /** Approval first, the money moves at the end (credit). Always the first step. */
  APPROVE_THEN_DISBURSE: 'APPROVE_THEN_DISBURSE',
  /** Held first, captured at the end (card). */
  HOLD_CAPTURE: 'HOLD_CAPTURE',
  /** Charged during the payment and refunded if the payment fails. */
  CAPTURE_REVERSIBLE: 'CAPTURE_REVERSIBLE',
  /** Cannot be reversed: at most one such leg, always charged last. */
  CAPTURE_IRREVERSIBLE: 'CAPTURE_IRREVERSIBLE',
});

/** Status of a split payment (`status`). */
const SplitPaymentStatus = Object.freeze({
  COMPOSING: 'COMPOSING',
  AUTHORIZING: 'AUTHORIZING',
  /** A card leg waits for the buyer's 3D Secure step (`pendingStep.redirectPath`). */
  AWAITING_3DS: 'AWAITING_3DS',
  /** A non-card leg waits for a step (`pendingStep`). */
  AWAITING_ACTION: 'AWAITING_ACTION',
  /** A credit leg waits for the lender's approval; no money has moved. */
  AWAITING_CREDIT_APPROVAL: 'AWAITING_CREDIT_APPROVAL',
  /** A card capture failed after the non-reversible leg; a new card is asked for the shortfall. */
  AWAITING_REPLACEMENT_CARD: 'AWAITING_REPLACEMENT_CARD',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURING: 'CAPTURING',
  /** Every leg was charged: the order is paid. */
  COMPLETED: 'COMPLETED',
  /** A leg failed: holds are released and charged legs are refunded. */
  COMPENSATING: 'COMPENSATING',
  /** Failed without a charge left on any leg. */
  VOIDED: 'VOIDED',
  FAILED: 'FAILED',
  /** The non-reversible leg was charged but the rest could not be collected; you decide on delivery. */
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
});

/**
 * Statuses in which the split payment is still running (waiting for a step or
 * being processed). `payments.createSplitPayment()` returns these responses
 * instead of throwing (see there).
 */
const SPLIT_PAYMENT_IN_PROGRESS_STATUSES = Object.freeze([
  SplitPaymentStatus.COMPOSING,
  SplitPaymentStatus.AUTHORIZING,
  SplitPaymentStatus.AWAITING_3DS,
  SplitPaymentStatus.AWAITING_ACTION,
  SplitPaymentStatus.AWAITING_CREDIT_APPROVAL,
  SplitPaymentStatus.AWAITING_REPLACEMENT_CARD,
  SplitPaymentStatus.AUTHORIZED,
  SplitPaymentStatus.CAPTURING,
]);

/** Status of a leg (`legs[].legStatus`, `steps[].status`). */
const SplitLegStatus = Object.freeze({
  PENDING: 'PENDING',
  AUTHORIZING: 'AUTHORIZING',
  AWAITING_3DS: 'AWAITING_3DS',
  AWAITING_ACTION: 'AWAITING_ACTION',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  VOIDED: 'VOIDED',
  REFUNDED: 'REFUNDED',
  COMPENSATING: 'COMPENSATING',
  FAILED: 'FAILED',
});

/** Kind of a step (`steps[].kind`). */
const SplitStepKind = Object.freeze({ CARD: 'CARD', METHOD: 'METHOD' });

/** What the split payment waits for (`pendingStep.step`). */
const SplitPendingStep = Object.freeze({
  /** Send the buyer to `pendingStep.redirectPath` (card 3D Secure). */
  THREE_DS: 'THREE_DS',
  /** Send the same request again with the same Idempotency-Key: the next non-card leg starts with its block. */
  START_METHOD: 'START_METHOD',
  /** Complete the action with `payments.confirmPaymentAction(pendingStep.paymentId, pendingStep.actionId, …)`. */
  ACTION: 'ACTION',
  /** The provider's result is being confirmed; read the split again later. */
  RESULT_PENDING: 'RESULT_PENDING',
  /** The lender's approval is awaited. */
  CREDIT_APPROVAL: 'CREDIT_APPROVAL',
  /** The buyer enters a card after the credit approval (Checkout Form). */
  CARD_INPUT: 'CARD_INPUT',
  /** The buyer enters a new card for the shortfall (Checkout Form). */
  REPLACEMENT_CARD: 'REPLACEMENT_CARD',
});

/** Refund view of a leg (`legs[].refundState` in the detail and in webhooks). */
const SplitLegRefundState = Object.freeze({
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  /** The leg cannot be reversed. */
  NOT_REFUNDABLE: 'NOT_REFUNDABLE',
});

/** Status of a refund of the main payment (`payments.refundSplitPayment()` → `data.status`). */
const SplitRefundStatus = Object.freeze({
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
});

/** Result of one leg in a refund of the main payment (`data.legs[].status`). */
const SplitRefundLegStatus = Object.freeze({ PENDING: 'PENDING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED' });

/** `split.role` of a payment row (`payments.list({ includeLegs })`, `payments.get()`). */
const PaymentSplitRole = Object.freeze({
  /** The main payment of a split payment (one row in the list). */
  PARENT: 'PARENT',
  /** A leg of a split payment. */
  LEG: 'LEG',
});

/** `reason` of `payment.split.reconciliation_required`. */
const SplitReconciliationReason = Object.freeze({
  REPLACEMENT_CARD_FAILED: 'REPLACEMENT_CARD_FAILED',
  REPLACEMENT_WINDOW_EXPIRED: 'REPLACEMENT_WINDOW_EXPIRED',
  BUYER_ABANDONED: 'BUYER_ABANDONED',
  CAPTURE_NOT_RECOVERABLE: 'CAPTURE_NOT_RECOVERABLE',
});

/**
 * Webhook event types of a split payment. The result of the main payment
 * arrives as `payment.captured` / `payment.failed` with `settlementMode: 'SPLIT'`
 * and `legs[]`; deliver the order on that event.
 */
const SplitPaymentEvents = Object.freeze({
  COMPLETED: 'payment.split.completed',
  VOIDED: 'payment.split.voided',
  COMPENSATING: 'payment.split.compensating',
  /** The non-reversible leg's result is being confirmed; card holds are kept until then. */
  OUTCOME_PENDING: 'payment.split.outcome_pending',
  /** The order could not be fully collected (`shortfallAmountMinor`, `reason`). */
  RECONCILIATION_REQUIRED: 'payment.split.reconciliation_required',
  /** Leg event: a charged leg is being refunded and retried until it succeeds. */
  LEG_REFUND_PENDING: 'payment.split.leg_refund_pending',
});

/**
 * Put this key into a webhook endpoint's event types to also receive the
 * events of each leg (`payment.captured` of a leg, leg refunds …). It is not an
 * event type and `payment.*` does not include it.
 */
const SPLIT_LEG_EVENTS_SUBSCRIPTION = 'payment.split.leg_events';

/** Error codes of split payments (`error.code`; docs: getting-started/errors#<code>). */
const SplitPayErrorCode = Object.freeze({
  /** 422 — split payments with non-card methods are disabled in your form settings. */
  METHODS_DISABLED: 'split_pay.validation.methods_disabled',
  /** 422 — the leg's method is not enabled for split payments. */
  METHOD_NOT_ALLOWED: 'split_pay.validation.method_not_allowed',
  /** 422 — the provider is not available for the method. */
  PROVIDER_NOT_AVAILABLE: 'split_pay.validation.provider_not_available',
  /** 422 — the provider cannot be used in a split payment (`splitEligible: false`). */
  PROVIDER_NOT_SPLIT_ELIGIBLE: 'split_pay.validation.provider_not_split_eligible',
  /** 422 — a provider appears in more than one leg. */
  DUPLICATE_PROVIDER: 'split_pay.validation.duplicate_provider',
  /** 422 — more than one non-reversible leg. */
  MULTIPLE_IRREVERSIBLE_LEGS: 'split_pay.validation.multiple_irreversible_legs',
  /** 422 — a leg is below your minimum leg amount (`details.minLegAmount`). */
  LEG_BELOW_MINIMUM: 'split_pay.validation.leg_below_minimum',
  /** 422 — a leg is outside the provider's limits (`details.minAmount`, `details.maxAmount`). */
  LEG_OUTSIDE_PROVIDER_LIMITS: 'split_pay.validation.leg_outside_provider_limits',
  /** 422 — too many card legs (`details.max`). */
  CARD_LEG_COUNT_OUT_OF_RANGE: 'split_pay.validation.card_leg_count_out_of_range',
  /** 422 — invalid installment count of a leg (`details.legIndex`, `details.max`). */
  INVALID_INSTALLMENT: 'split_pay.validation.invalid_installment',
  /** 422 — the installment quote of a card leg cannot be used (`details.legIndex`, `details.reason`). */
  INSTALLMENT_QUOTE_REJECTED: 'split_pay.validation.installment_quote_rejected',
  /** 422 — the legs do not add up to `totalAmount`. */
  AMOUNT_MISMATCH: 'split_pay.validation.amount_mismatch',
  /** 422 — too few or too many legs (`details.min`, `details.max`). */
  LEG_COUNT_OUT_OF_RANGE: 'split_pay.validation.leg_count_out_of_range',
  /** 422 — a leg amount is not a positive integer. */
  INVALID_LEG_AMOUNT: 'split_pay.validation.invalid_leg_amount',
  /** 422 — a leg's currency differs from the payment, or the provider does not support it. */
  CURRENCY_MISMATCH: 'split_pay.validation.currency_mismatch',
  /** 422 — a card leg without a card, or a non-card leg with one (`details.index`). */
  MISSING_CARD_TOKEN: 'split_pay.validation.missing_card_token',
  /** 409 — the step cannot be taken now (`details.reason`). */
  STEP_NOT_ALLOWED: 'split_pay.step.not_allowed',
  /** 409 — the split payment is being processed; try again in a few seconds. */
  STEP_BUSY: 'split_pay.step.busy',
  /** 410 — the continuation link can no longer be used (`details.reason`). */
  CONTINUATION_UNAVAILABLE: 'split_pay.continuation.unavailable',
  /** 410 — the continuation page link is invalid or has expired (`details.reason`: INVALID, EXPIRED). */
  RESUME_UNAVAILABLE: 'split_pay.resume.unavailable',
  /** 409 — the continuation page is already open in another window. */
  RESUME_ALREADY_OPENED: 'split_pay.resume.already_opened',
  /** 401 — the continuation page session could not be verified. */
  RESUME_PROOF_INVALID: 'split_pay.resume.proof_invalid',
  /** 503 — split payment cannot be started right now; nothing was started and no money moved. */
  RESUME_NOT_CONFIGURED: 'split_pay.resume.not_configured',
  /** 409 — 3D Secure of this card leg was already restarted once on a separate page. */
  THREE_DS_RESTART_EXHAUSTED: 'split_pay.three_ds.restart_exhausted',
  /**
   * 410 — the 3D Secure session of this card leg is closed or has expired; no restart is made and the
   * buyer is asked to enter the card again (`details.reason`: THREE_DS_CLOSED, THREE_DS_SESSION_EXPIRED).
   */
  THREE_DS_RESTART_EXPIRED: 'split_pay.three_ds.restart_expired',
  /** 409 — the order is not open for a split payment (Checkout Form; `details.reason`). */
  CHECKOUT_ORDER_NOT_OPEN: 'split_pay.checkout.order_not_open',
  /**
   * 422 — insurance is selected in the Checkout Form but the split payment has no card leg; the premium
   * is collected from a card leg (`details.canContinueWithoutInsurance`). Card legs of an insured split
   * payment are single-payment (no installments).
   */
  INSURANCE_REQUIRES_CARD_LEG: 'split_pay.insurance.requires_card_leg',
  /** 400 — the refund exceeds the refundable amount (`details.refundableAmount`, `details.nonRefundableAmount`). */
  REFUND_AMOUNT_EXCEEDED: 'split_pay.refund.amount_exceeded',
  /** 422 — the refund cannot be split across the legs (non-card legs are refunded only in full). */
  REFUND_AMOUNT_NOT_DISTRIBUTABLE: 'split_pay.refund.amount_not_distributable',
  /** 409 — a refund is not possible now (`details.reason`). */
  REFUND_NOT_ALLOWED: 'split_pay.refund.not_allowed',
  /** Some legs could not be refunded; retry with the same Idempotency-Key. */
  REFUND_INCOMPLETE: 'split_pay.refund.incomplete',
});

/**
 * How the Checkout Form opens a card leg's 3D Secure in a split payment
 * (panel: Form Settings → 3D Secure → 3D Secure display). Set in the panel,
 * not through the API; the form's split answers carry the value the payment
 * started with as `threeDsDisplay`.
 *  - INLINE (default): in a window over the form; if the bank does not allow a
 *    window, 3D Secure is restarted once on a separate page.
 *  - REDIRECT: on a separate page; the remaining steps run on the hosted
 *    continuation page and the buyer returns to your `callbackUrl` at the end.
 */
const ThreeDsDisplay = Object.freeze({
  INLINE: 'INLINE',
  REDIRECT: 'REDIRECT',
});

/**
 * `status` of the signed POST sent to your `callbackUrl` when a split payment
 * concludes on the continuation page (`completion.outcome`): COMPLETED →
 * success; VOIDED, FAILED, COMPENSATING → failure; RECONCILIATION_REQUIRED →
 * pending. Informational; the main payment's webhook is authoritative.
 */
const SplitCompletionOutcome = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  PENDING: 'pending',
});

/** Checkout Form error codes of payment options and the order lock (`error.code`). */
const CheckoutFormErrorCode = Object.freeze({
  /** 422 — the provider is turned off in your checkout form (the API still accepts it). */
  PROVIDER_DISABLED_IN_FORM: 'payment.provider.disabled_in_form',
  /** 409 — the buyer used the 3 method selections of the payment. */
  METHOD_SELECTION_ATTEMPTS_EXHAUSTED: 'payment.method.selection_attempts_exhausted',
  /** 409 — a split payment is running for the order; another method cannot start. */
  ORDER_LOCKED: 'payment.checkout.order_locked',
});

/** Body fields of `POST /payments/split` (gateway `SplitPaymentDto`). */
const SPLIT_PAYMENT_FIELDS = Object.freeze(['totalAmount', 'currency', 'ownerRef', 'legs', 'orderId', 'ownerScope', 'callbackUrl']);

/** Fields of one leg (gateway `SplitPaymentLegDto`). */
const SPLIT_PAYMENT_LEG_FIELDS = Object.freeze([
  'paymentMethod',
  'cardToken',
  'amount',
  'force3D',
  'installment',
  'installmentQuoteToken',
  ...METHOD_BLOCK_FIELDS,
]);

/** Fields that belong to a card leg only. */
const SPLIT_CARD_LEG_ONLY_FIELDS = Object.freeze(['cardToken', 'force3D', 'installmentQuoteToken']);

/** Body fields of `POST /payments/split/{id}/refund` (gateway `RefundSplitPaymentDto`). */
const SPLIT_REFUND_FIELDS = Object.freeze(['amount', 'reason']);

/** Filters of `GET /payments/split` (gateway `ListSplitPaymentsDto`). */
const LIST_SPLIT_PAYMENTS_FILTERS = Object.freeze(['status', 'currency', 'createdFrom', 'createdTo', 'orderId', 'ownerRef', 'limit', 'after']);

const SPLIT_MIN_LEGS = 1;
const SPLIT_MAX_LEGS = 5;
const SPLIT_LEG_MAX_INSTALLMENT = 36;
const SPLIT_CARD_TOKEN_MAX_LENGTH = 256;
const SPLIT_QUOTE_TOKEN_MAX_LENGTH = 4096;
const SPLIT_CALLBACK_URL_MAX_LENGTH = 2048;
const SPLIT_REFUND_REASON_MAX_LENGTH = 500;
const SPLIT_LIST_MAX_LIMIT = 100;
const SPLIT_LIST_MAX_VALUES = 20;
const SPLIT_FILTER_TEXT_MAX_LENGTH = 200;
/** Longest `Idempotency-Key` the gateway accepts on the split endpoints. */
const SPLIT_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const OWNER_SCOPES = Object.freeze(['MERCHANT_CUSTOMER']);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function given(value) {
  return value !== undefined && value !== null;
}

/** A card leg: `paymentMethod` left out, empty or `CARD`. */
function isCardLeg(leg) {
  return !given(leg.paymentMethod) || leg.paymentMethod === '' || leg.paymentMethod === PaymentMethod.CARD;
}

function requirePositiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigurationError(`${path} must be a positive integer amount in minor units; got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireBoundedText(value, path, maxLength) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new ConfigurationError(`${path} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function requireNonEmptyText(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`${path} must be a non-empty string.`);
  }
  return value;
}

function requireHttpUrl(value, path) {
  requireBoundedText(value, path, SPLIT_CALLBACK_URL_MAX_LENGTH);
  if (!/^https?:\/\//i.test(value)) {
    throw new ConfigurationError(`${path} must be an http(s) URL; got ${JSON.stringify(value)}.`);
  }
  return value;
}

/** The `Idempotency-Key` of a split call: required, at most 200 characters. */
function requireSplitIdempotencyKey(operation, key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    throw new ConfigurationError(`A stable Idempotency-Key is required for ${operation}. Reuse the same key when retrying, and to continue the same split payment after a step.`);
  }
  if (trimmed.length > SPLIT_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ConfigurationError(`The Idempotency-Key of ${operation} can be at most ${SPLIT_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`);
  }
  return trimmed;
}

function requireSplitPaymentId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError('splitPaymentId is required (data.splitPaymentId of the split payment).');
  }
  return value;
}

function assertCardLeg(leg, path) {
  requireBoundedText(leg.cardToken, `${path}.cardToken`, SPLIT_CARD_TOKEN_MAX_LENGTH);
  const block = METHOD_BLOCK_FIELDS.find((field) => given(leg[field]));
  if (block) throw new ConfigurationError(`${path} is a card leg and cannot carry the '${block}' block.`);
  if (given(leg.force3D) && typeof leg.force3D !== 'boolean') {
    throw new ConfigurationError(`${path}.force3D must be a boolean; got ${JSON.stringify(leg.force3D)}.`);
  }
  if (given(leg.installment)) {
    if (!Number.isSafeInteger(leg.installment) || leg.installment < 1 || leg.installment > SPLIT_LEG_MAX_INSTALLMENT) {
      throw new ConfigurationError(`${path}.installment must be an integer from 1 to ${SPLIT_LEG_MAX_INSTALLMENT}; got ${JSON.stringify(leg.installment)}.`);
    }
  }
  if (given(leg.installmentQuoteToken)) {
    requireBoundedText(leg.installmentQuoteToken, `${path}.installmentQuoteToken`, SPLIT_QUOTE_TOKEN_MAX_LENGTH);
  }
  if (given(leg.installment) && leg.installment >= 2 && !given(leg.installmentQuoteToken)) {
    throw new ConfigurationError(`${path}: an installment of 2 or more needs installmentQuoteToken (POST /bin/installments with this leg's amount).`);
  }
}

/** Returns the leg's `providerCode`. */
function assertMethodLeg(leg, path) {
  const method = normalizePaymentMethod(leg.paymentMethod);
  const blockName = blockNameOf(method);
  if (!METHOD_BLOCK_FIELDS.includes(blockName)) {
    throw new ConfigurationError(`${path}: paymentMethod ${method} cannot be a split payment leg; a non-card leg carries one of the blocks ${METHOD_BLOCK_FIELDS.join(', ')}.`);
  }
  const cardField = SPLIT_CARD_LEG_ONLY_FIELDS.find((field) => given(leg[field]));
  if (cardField) throw new ConfigurationError(`${path}: ${cardField} can only be sent with a card leg.`);
  if (given(leg.installment) && leg.installment !== 1) {
    throw new ConfigurationError(`${path}: installment can only be sent with a card leg.`);
  }
  const otherBlock = METHOD_BLOCK_FIELDS.find((field) => field !== blockName && given(leg[field]));
  if (otherBlock) throw new ConfigurationError(`${path}: paymentMethod ${method} takes only the '${blockName}' block; '${otherBlock}' must not be sent.`);
  const block = leg[blockName];
  if (!isPlainObject(block)) throw new ConfigurationError(`${path}: paymentMethod ${method} requires the '${blockName}' block.`);
  const { providerCode, ...fields } = block;
  if (!given(providerCode)) {
    throw new ConfigurationError(`${path}.${blockName}.providerCode is required in a split payment leg (a provider with splitEligible: true from payments.listPaymentMethods()).`);
  }
  requireProviderCode(providerCode);
  requireMethodFields(fields, `${path}.${blockName}`);
  if (method === PaymentMethod.PROMISSORY_NOTE) {
    if (given(fields.schedule)) {
      throw new ConfigurationError(`${path}.${blockName}.schedule cannot be sent in a split payment leg; give the number of notes with noteCount.`);
    }
    requireNoteCount(fields.noteCount, `${path}.${blockName}.noteCount`);
  }
  return providerCode;
}

/**
 * Checks a `POST /payments/split` body before sending, with the gateway's
 * rules: known fields only, 1–5 legs, integer minor-unit amounts that add up
 * to `totalAmount`, a card leg with `cardToken` and no method block, a non-card
 * leg with exactly its own block (with `providerCode`) and no card fields, one
 * leg per provider, `callbackUrl` when a card leg uses 3D Secure.
 */
function assertSplitPaymentPayload(body) {
  if (!isPlainObject(body)) {
    throw new ConfigurationError('A split payment needs a body. Use SplitPaymentRequest to build it.');
  }
  const unknown = Object.keys(body).filter((key) => !SPLIT_PAYMENT_FIELDS.includes(key));
  if (unknown.length > 0) throw new ConfigurationError(`Unknown split payment field(s): ${unknown.join(', ')}.`);
  requirePositiveInteger(body.totalAmount, 'totalAmount');
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {
    throw new ConfigurationError(`currency must be an ISO 4217 code such as TRY; got ${JSON.stringify(body.currency)}.`);
  }
  requireNonEmptyText(body.ownerRef, 'ownerRef');
  if (given(body.orderId)) requireNonEmptyText(body.orderId, 'orderId');
  if (given(body.ownerScope) && !OWNER_SCOPES.includes(body.ownerScope)) {
    throw new ConfigurationError(`ownerScope can only be ${OWNER_SCOPES.join(', ')}; got ${JSON.stringify(body.ownerScope)}.`);
  }
  if (given(body.callbackUrl)) requireHttpUrl(body.callbackUrl, 'callbackUrl');
  if (!Array.isArray(body.legs) || body.legs.length < SPLIT_MIN_LEGS || body.legs.length > SPLIT_MAX_LEGS) {
    throw new ConfigurationError(`legs must be a list of ${SPLIT_MIN_LEGS} to ${SPLIT_MAX_LEGS} legs.`);
  }
  const providers = new Set();
  const cardTokens = new Set();
  let sum = 0;
  body.legs.forEach((leg, index) => {
    const path = `legs[${index}]`;
    if (!isPlainObject(leg)) throw new ConfigurationError(`${path} must be a plain object.`);
    const unknownLeg = Object.keys(leg).filter((key) => !SPLIT_PAYMENT_LEG_FIELDS.includes(key));
    if (unknownLeg.length > 0) throw new ConfigurationError(`Unknown ${path} field(s): ${unknownLeg.join(', ')}.`);
    sum += requirePositiveInteger(leg.amount, `${path}.amount`);
    if (isCardLeg(leg)) {
      assertCardLeg(leg, path);
      if (cardTokens.has(leg.cardToken)) throw new ConfigurationError(`${path}: the same card is used in more than one leg.`);
      cardTokens.add(leg.cardToken);
      return;
    }
    const providerCode = assertMethodLeg(leg, path);
    if (providers.has(providerCode)) throw new ConfigurationError(`${path}: provider ${providerCode} is used in more than one leg; one leg per provider.`);
    providers.add(providerCode);
  });
  if (sum !== body.totalAmount) {
    throw new ConfigurationError(`The legs add up to ${sum} but totalAmount is ${body.totalAmount}; they must be equal.`);
  }
  if (body.legs.some((leg) => leg.force3D === true) && !given(body.callbackUrl)) {
    throw new ConfigurationError('callbackUrl is required when a card leg uses 3D Secure (force3D: true).');
  }
}

/** Body of `POST /payments/split/{id}/refund`. */
function splitRefundBody(amount, reason) {
  const body = { amount: requirePositiveInteger(amount, 'amount') };
  if (given(reason) && reason !== '') {
    if (typeof reason !== 'string' || reason.length > SPLIT_REFUND_REASON_MAX_LENGTH) {
      throw new ConfigurationError(`reason must be a string of at most ${SPLIT_REFUND_REASON_MAX_LENGTH} characters.`);
    }
    body.reason = reason;
  }
  return body;
}

function filterValues(value, field, check) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > SPLIT_LIST_MAX_VALUES) {
    throw new ConfigurationError(`${field} takes 1 to ${SPLIT_LIST_MAX_VALUES} values.`);
  }
  values.forEach(check);
  return values;
}

/**
 * Query string of `GET /payments/split`. `status` and `currency` may be a
 * value or a list; a list is sent as repeated parameters
 * (`?status=COMPLETED&status=VOIDED`), as the gateway expects.
 */
function listSplitPaymentsQuery(filters) {
  if (filters === undefined || filters === null) return '';
  if (!isPlainObject(filters)) {
    throw new ConfigurationError('listSplitPayments filters must be an object such as { status: \'COMPLETED\', limit: 25 }.');
  }
  const unknown = Object.keys(filters).filter((key) => !LIST_SPLIT_PAYMENTS_FILTERS.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`listSplitPayments does not take ${unknown.join(', ')}; filters: ${LIST_SPLIT_PAYMENTS_FILTERS.join(', ')}.`);
  }
  const pairs = [];
  for (const key of LIST_SPLIT_PAYMENTS_FILTERS) {
    const value = filters[key];
    if (!given(value) || value === '') continue;
    if (key === 'status') {
      const statuses = Object.values(SplitPaymentStatus);
      filterValues(value, key, (entry) => {
        if (!statuses.includes(entry)) throw new ConfigurationError(`status must be one of ${statuses.join(', ')}; got ${JSON.stringify(entry)}.`);
      }).forEach((entry) => pairs.push([key, entry]));
    } else if (key === 'currency') {
      filterValues(value, key, (entry) => {
        if (typeof entry !== 'string' || !/^[A-Z]{3}$/.test(entry)) throw new ConfigurationError(`currency must be an ISO 4217 code; got ${JSON.stringify(entry)}.`);
      }).forEach((entry) => pairs.push([key, entry]));
    } else if (key === 'createdFrom' || key === 'createdTo') {
      if (typeof value !== 'string' || !ISO_8601.test(value)) throw new ConfigurationError(`${key} must be an ISO 8601 date-time; got ${JSON.stringify(value)}.`);
      pairs.push([key, value]);
    } else if (key === 'limit') {
      if (!Number.isSafeInteger(value) || value < 1 || value > SPLIT_LIST_MAX_LIMIT) {
        throw new ConfigurationError(`limit must be an integer from 1 to ${SPLIT_LIST_MAX_LIMIT}; got ${JSON.stringify(value)}.`);
      }
      pairs.push([key, String(value)]);
    } else {
      pairs.push([key, requireBoundedText(value, key, key === 'after' ? 2048 : SPLIT_FILTER_TEXT_MAX_LENGTH)]);
    }
  }
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

module.exports = {
  SplitBehavior,
  SplitPaymentStatus,
  SPLIT_PAYMENT_IN_PROGRESS_STATUSES,
  SplitLegStatus,
  SplitStepKind,
  SplitPendingStep,
  SplitLegRefundState,
  SplitRefundStatus,
  SplitRefundLegStatus,
  PaymentSplitRole,
  SplitReconciliationReason,
  SplitPaymentEvents,
  SPLIT_LEG_EVENTS_SUBSCRIPTION,
  SplitPayErrorCode,
  CheckoutFormErrorCode,
  ThreeDsDisplay,
  SplitCompletionOutcome,
  SPLIT_PAYMENT_FIELDS,
  SPLIT_PAYMENT_LEG_FIELDS,
  SPLIT_REFUND_FIELDS,
  LIST_SPLIT_PAYMENTS_FILTERS,
  SPLIT_MIN_LEGS,
  SPLIT_MAX_LEGS,
  SPLIT_LEG_MAX_INSTALLMENT,
  SPLIT_IDEMPOTENCY_KEY_MAX_LENGTH,
  isCardLeg,
  assertSplitPaymentPayload,
  requireSplitIdempotencyKey,
  requireSplitPaymentId,
  splitRefundBody,
  listSplitPaymentsQuery,
};
