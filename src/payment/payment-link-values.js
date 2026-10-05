'use strict';

/**
 * Closed value sets of the payment-link API (`/api/v1/payments/links`).
 *
 * The gateway validates every one of these with a fixed list and answers an
 * unknown value with 400, so they are exported as constants instead of being
 * typed by hand at each call site.
 */

const PaymentLinkUsage = Object.freeze({
  /** Can be paid once. The typical invoice / personal payment request. */
  SINGLE_USE: 'SINGLE_USE',
  /** Can be paid many times (donations, tickets, a product page). */
  MULTI_USE: 'MULTI_USE',
});

const PaymentLinkAmountMode = Object.freeze({
  /** The merchant sets the amount (`amountMinor`). */
  FIXED: 'FIXED',
  /** The buyer enters the amount, bounded by `minAmountMinor` / `maxAmountMinor`. */
  OPEN: 'OPEN',
  /** The buyer picks quantities from `items`; the amount is the sum of the lines. */
  ITEMIZED: 'ITEMIZED',
});

const PaymentLinkState = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  DEACTIVATED: 'DEACTIVATED',
  /** Removed by Lunixi. Every write on the link answers 409 `payment_link.link.taken_down`. */
  TAKEN_DOWN: 'TAKEN_DOWN',
});

const PaymentLinkAttemptState = Object.freeze({
  OPEN: 'OPEN',
  BOUND: 'BOUND',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  ABANDONED: 'ABANDONED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
});

const PaymentLinkEnvironment = Object.freeze({
  TEST: 'TEST',
  LIVE: 'LIVE',
});

const BuyerFieldRequirement = Object.freeze({
  HIDDEN: 'HIDDEN',
  OPTIONAL: 'OPTIONAL',
  REQUIRED: 'REQUIRED',
});

const CustomFieldType = Object.freeze({
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  DATE: 'DATE',
  SELECT: 'SELECT',
  CHECKBOX: 'CHECKBOX',
  TCKN: 'TCKN',
  VKN: 'VKN',
});

const PaymentLinkButtonLabel = Object.freeze({
  PAY: 'PAY',
  DONATE: 'DONATE',
  BUY: 'BUY',
  BOOK: 'BOOK',
});

const PaymentLinkDeliveryChannel = Object.freeze({
  EMAIL: 'EMAIL',
  SMS: 'SMS',
});

const PaymentLinkQrFormat = Object.freeze({
  SVG: 'svg',
  PNG: 'png',
});

const PaymentLinkLocale = Object.freeze({
  TR: 'tr',
  EN: 'en',
});

/**
 * Types a payment-link image can be declared as. On confirmation media checks
 * the stored file's own bytes against the declared type; SVG is never accepted.
 */
const PaymentLinkImageContentType = Object.freeze({
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp',
});

/**
 * Every field of a payment-link definition, in the gateway's REST (camelCase)
 * spelling. Create and update bodies may carry only these keys (plus
 * `environment` on create, `expectedRowVersion` on update); the gateway rejects
 * any other key with 400.
 */
const PAYMENT_LINK_SPEC_FIELDS = Object.freeze([
  'usage',
  'amountMode',
  'currency',
  'amountMinor',
  'minAmountMinor',
  'maxAmountMinor',
  'suggestedAmountsMinor',
  'quantityEnabled',
  'minQuantity',
  'maxQuantity',
  'items',
  'capacity',
  'title',
  'description',
  'imageAssetId',
  'successMessage',
  'successRedirectUrl',
  'taxNote',
  'locale',
  'startsAt',
  'expiresAt',
  'eventAt',
  'buttonLabelKey',
  'requireTermsAcceptance',
  'buyerFields',
  'customFields',
  'recipient',
  'prefill',
  'verification',
  'reminders',
  'checkout',
  'reference',
  'tags',
  'branchCode',
  'salesChannel',
  'campaign',
  'agentCode',
  'merchantNotifyEmails',
  'metadata',
]);

/** Fixed when the link is created; an update that names one answers 422 `payment_link.link.immutable_field`. */
const PAYMENT_LINK_IMMUTABLE_FIELDS = Object.freeze(['usage', 'amountMode', 'currency']);

/** `Idempotency-Key` format the gateway accepts: 8–200 printable ASCII characters, no spaces. */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,200}$/;

/** Shape of a media asset id (the gateway checks it as a uuid; ownership and state are the server's). */
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = {
  PaymentLinkUsage,
  PaymentLinkAmountMode,
  PaymentLinkState,
  PaymentLinkAttemptState,
  PaymentLinkEnvironment,
  BuyerFieldRequirement,
  CustomFieldType,
  PaymentLinkButtonLabel,
  PaymentLinkDeliveryChannel,
  PaymentLinkQrFormat,
  PaymentLinkLocale,
  PaymentLinkImageContentType,
  PAYMENT_LINK_SPEC_FIELDS,
  PAYMENT_LINK_IMMUTABLE_FIELDS,
  IDEMPOTENCY_KEY_PATTERN,
  ASSET_ID_PATTERN,
};
