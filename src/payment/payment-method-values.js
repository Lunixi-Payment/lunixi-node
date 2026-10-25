'use strict';

/**
 * Value sets and request rules of the payment-method endpoints:
 *
 *   POST /api/v1/payments/direct/payment                          (start a payment with any method)
 *   POST /api/v1/payments/{paymentId}/actions/{actionId}/confirm  (OTP, consent, requested fields)
 *   POST /api/v1/payments/{paymentId}/actions/{actionId}/resend   (new one-time code)
 *   GET  /api/v1/payments/methods[?paymentMethod=]                (methods open for the merchant)
 *
 * The gateway validates bodies with `forbidNonWhitelisted`: a key outside its DTO
 * is a 400. The field lists below are the DTO's, so the SDK and the Postman
 * collections (postman/test) are checked against the same source.
 */

const { ConfigurationError } = require('../errors');

/** Public payment method codes (`paymentMethod`). `QR` is accepted as an alias of `QR_CODE`. */
const PaymentMethod = Object.freeze({
  CARD: 'CARD',
  BNPL: 'BNPL',
  SHOPPING_LOAN: 'SHOPPING_LOAN',
  PROMISSORY_NOTE: 'PROMISSORY_NOTE',
  MEAL_CARD: 'MEAL_CARD',
  GIFT_CARD: 'GIFT_CARD',
  CASH: 'CASH',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
  WALLET: 'WALLET',
  BANK_TRANSFER: 'BANK_TRANSFER',
  OPEN_BANKING: 'OPEN_BANKING',
  /** Faturana Yansıt (charge to the mobile phone bill). */
  MOBILE_BILLING: 'MOBILE_BILLING',
  QR_CODE: 'QR_CODE',
  CRYPTO: 'CRYPTO',
  OTHER: 'OTHER',
});

const PAYMENT_METHOD_ALIASES = Object.freeze({ QR: PaymentMethod.QR_CODE });

/** What the buyer must do when a payment response carries `action` (`action.type`). */
const PaymentActionType = Object.freeze({
  /** Send the one-time code with `payments.confirmPaymentAction()`. */
  OTP: 'OTP',
  /** Send the buyer to `action.redirect.url` (for cards: the bank's 3D Secure page). */
  REDIRECT: 'REDIRECT',
  /** Show the buyer something to act on outside the page (transfer details, a code). */
  DISPLAY: 'DISPLAY',
  /** The buyer approves in the provider's app; the result arrives by webhook. */
  APP_APPROVAL: 'APP_APPROVAL',
  /** Send the fields listed in `action.input.fields` with `payments.confirmPaymentAction()`. */
  INPUT: 'INPUT',
});

/** `providerSelection` of a method in `payments.listPaymentMethods()`. */
const ProviderSelection = Object.freeze({
  /** Card: routing picks the provider; `providerCode` is not sent. */
  ROUTED: 'ROUTED',
  /**
   * `providerCode` may be omitted: one provider is connected, or the platform
   * picks the provider (`providerSelectionMode: PLATFORM`).
   */
  OPTIONAL: 'OPTIONAL',
  /** The buyer picks the brand and more than one provider is connected; `providerCode` must be sent. */
  REQUIRED: 'REQUIRED',
});

/** `providerSelectionMode` of a method in `payments.listPaymentMethods()`: who picks the provider. */
const ProviderSelectionMode = Object.freeze({
  /**
   * The buyer picks the brand (wallet brand, lending bank, card brand). With
   * more than one provider connected `providerCode` is required; without it the
   * gateway answers 400 `payment.provider.required`.
   */
  BUYER: 'BUYER',
  /**
   * The buyer does not pick a brand. `providerCode` is optional: when it is
   * omitted the platform picks one of the connected providers before any money
   * moves and keeps it for the payment. When none of them can take the payment
   * the gateway answers 422 `payment.provider.none_eligible`.
   */
  PLATFORM: 'PLATFORM',
});

/** Value type of a provider's `inputFields[].type`. */
const MethodInputFieldType = Object.freeze({
  PHONE: 'PHONE',
  TCKN: 'TCKN',
  EMAIL: 'EMAIL',
  DATE: 'DATE',
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  SELECT: 'SELECT',
  CONSENT: 'CONSENT',
  /** 10-digit Turkish tax number (with checksum). */
  VKN: 'VKN',
  /** Object `{ provinceCode, districtCode, neighborhoodCode, line }`; codes from `client.reference`. */
  ADDRESS: 'ADDRESS',
  /** List of objects, each with the field's `itemFields`; `minItems` / `maxItems` bound the count. */
  GROUP: 'GROUP',
});

/** Order, card and option fields of `POST /payments/direct/payment`. */
const DIRECT_METHOD_PAYMENT_FIELDS_WITHOUT_BLOCKS = [
  'paymentMethod',
  'amount',
  'currency',
  'orderId',
  'paymentChannel',
  'paymentGroup',
  'callbackUrl',
  'locale',
  'description',
  'customerId',
  'preauth',
  'buyer',
  'shippingAddress',
  'billingAddress',
  'basketItems',
  'card',
  'installment',
  'installmentQuoteToken',
  'force3D',
  'metadata',
];

/**
 * Method blocks the gateway accepts today besides `card`. The block of the
 * chosen method is required; a block for another method is a 400. A method
 * without a block here cannot be paid yet; `payments.listPaymentMethods()` lists
 * only the methods that can.
 */
const METHOD_BLOCK_FIELDS = Object.freeze(['mobileBilling', 'wallet', 'promissoryNote']);

/** Body fields of `POST /payments/direct/payment` (gateway `DirectMethodPaymentDto`). */
const DIRECT_METHOD_PAYMENT_FIELDS = Object.freeze([...DIRECT_METHOD_PAYMENT_FIELDS_WITHOUT_BLOCKS, ...METHOD_BLOCK_FIELDS]);

/** Fields that belong to a card payment only (`paymentMethod: CARD`). */
const CARD_ONLY_FIELDS = Object.freeze(['card', 'installment', 'installmentQuoteToken', 'force3D']);

/**
 * Body fields of `POST /payments/{id}/actions/{actionId}/confirm` that a merchant
 * server sends. The checkout token fields (`token`, `checkoutSessionProof`) are
 * the hosted form's; a signed request that also carries a token is refused with
 * 400 `payment.action.auth_ambiguous`, so the SDK never sends them.
 */
const PAYMENT_ACTION_CONFIRM_FIELDS = Object.freeze(['otp', 'consentAccepted', 'fields']);

/** Limits of a method block / confirm `fields` (same as the gateway). */
const METHOD_FIELDS_MAX_KEYS = 32;
const METHOD_FIELD_MAX_VALUE_LENGTH = 1024;
/** GROUP item count and keys of a nested object (ADDRESS value), same as the gateway. */
const METHOD_FIELD_MAX_GROUP_ITEMS = 10;
const METHOD_FIELD_MAX_NESTED_KEYS = 16;
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const PROVIDER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const METHOD_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const RESERVED_FIELD_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/** Options of `payments.listPaymentMethods()`. */
const LIST_PAYMENT_METHODS_OPTIONS = Object.freeze(['paymentMethod']);

/**
 * Query of `GET /payments/methods`. `paymentMethod` narrows the list to one
 * method (`{ methods: [] }` when it is not open for the account); without it
 * every open method is listed.
 */
function listPaymentMethodsQuery(options) {
  if (options === undefined || options === null) return undefined;
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new ConfigurationError('listPaymentMethods options must be an object such as { paymentMethod: \'MOBILE_BILLING\' }.');
  }
  for (const key of Object.keys(options)) {
    if (!LIST_PAYMENT_METHODS_OPTIONS.includes(key)) {
      throw new ConfigurationError(`listPaymentMethods does not take ${JSON.stringify(key)}; options: ${LIST_PAYMENT_METHODS_OPTIONS.join(', ')}.`);
    }
  }
  if (options.paymentMethod === undefined || options.paymentMethod === null) return undefined;
  return { paymentMethod: normalizePaymentMethod(options.paymentMethod) };
}

/** Canonical method code; `QR` becomes `QR_CODE`. */
function normalizePaymentMethod(value) {
  if (typeof value !== 'string' || !METHOD_CODE_PATTERN.test(value)) {
    throw new ConfigurationError(`paymentMethod must be a payment method code such as ${PaymentMethod.MOBILE_BILLING}; got ${JSON.stringify(value)}.`);
  }
  return PAYMENT_METHOD_ALIASES[value] || value;
}

/**
 * Name of the method's block in the request body: the camelCase form of the
 * method code (`MOBILE_BILLING` → `mobileBilling`). It is also returned as
 * `blockName` by `payments.listPaymentMethods()`.
 */
function blockNameOf(paymentMethod) {
  const code = normalizePaymentMethod(paymentMethod);
  return code.toLowerCase().replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function requireProviderCode(value) {
  if (typeof value !== 'string' || !PROVIDER_CODE_PATTERN.test(value)) {
    throw new ConfigurationError(`providerCode must be a provider code from payments.listPaymentMethods() (letters, digits, _ and -); got ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Structure of a method block or of confirm `fields`. The fields themselves are
 * the provider's declaration (`inputFields`) and are validated by the gateway;
 * the SDK stops a body the gateway would reject for its shape alone:
 *   - a plain object of at most 32 fields, names start with a letter and hold
 *     only letters and digits;
 *   - a value is a string (at most 1024 characters), a finite number or a
 *     boolean; an object of such values (`ADDRESS`, at most 16 fields); or a
 *     list of at most 10 objects (`GROUP`) whose values are scalars or objects.
 */
function requireMethodFields(value, path) {
  if (!isPlainObject(value)) {
    throw new ConfigurationError(`${path} must be a plain object of field values.`);
  }
  const entries = Object.entries(value);
  if (entries.length > METHOD_FIELDS_MAX_KEYS) {
    throw new ConfigurationError(`${path} can carry at most ${METHOD_FIELDS_MAX_KEYS} fields.`);
  }
  for (const [key, field] of entries) {
    if (key === 'providerCode') {
      throw new ConfigurationError(`${path} must not carry providerCode; pass it as its own argument.`);
    }
    requireFieldKey(key, path);
    requireFieldValue(field, `${path}.${key}`, true);
  }
  return { ...value };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isScalarFieldValue(value) {
  return (typeof value === 'string' && value.length <= METHOD_FIELD_MAX_VALUE_LENGTH)
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function requireFieldKey(key, path) {
  if (!FIELD_KEY_PATTERN.test(key) || RESERVED_FIELD_KEYS.includes(key)) {
    throw new ConfigurationError(`${path} has an invalid field name ${JSON.stringify(key)}: field names start with a letter and contain only letters and digits.`);
  }
}

function requireNestedObject(value, path) {
  const entries = Object.entries(value);
  if (entries.length > METHOD_FIELD_MAX_NESTED_KEYS) {
    throw new ConfigurationError(`${path} can carry at most ${METHOD_FIELD_MAX_NESTED_KEYS} fields.`);
  }
  for (const [key, field] of entries) {
    requireFieldKey(key, path);
    if (!isScalarFieldValue(field)) {
      throw new ConfigurationError(`${path}.${key} must be a string (at most ${METHOD_FIELD_MAX_VALUE_LENGTH} characters), a number or a boolean.`);
    }
  }
}

function requireFieldValue(value, path, allowList) {
  if (isScalarFieldValue(value)) return;
  if (isPlainObject(value)) {
    requireNestedObject(value, path);
    return;
  }
  if (allowList && Array.isArray(value)) {
    if (value.length > METHOD_FIELD_MAX_GROUP_ITEMS) {
      throw new ConfigurationError(`${path} can carry at most ${METHOD_FIELD_MAX_GROUP_ITEMS} items.`);
    }
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isPlainObject(item)) throw new ConfigurationError(`${itemPath} must be a plain object.`);
      const entries = Object.entries(item);
      if (entries.length > METHOD_FIELDS_MAX_KEYS) {
        throw new ConfigurationError(`${itemPath} can carry at most ${METHOD_FIELDS_MAX_KEYS} fields.`);
      }
      for (const [key, field] of entries) {
        requireFieldKey(key, itemPath);
        requireFieldValue(field, `${itemPath}.${key}`, false);
      }
    });
    return;
  }
  throw new ConfigurationError(`${path} must be a string (at most ${METHOD_FIELD_MAX_VALUE_LENGTH} characters), a number, a boolean, an object or a list of objects.`);
}

module.exports = {
  PaymentMethod,
  PaymentActionType,
  ProviderSelection,
  ProviderSelectionMode,
  MethodInputFieldType,
  DIRECT_METHOD_PAYMENT_FIELDS,
  METHOD_BLOCK_FIELDS,
  CARD_ONLY_FIELDS,
  PAYMENT_ACTION_CONFIRM_FIELDS,
  normalizePaymentMethod,
  listPaymentMethodsQuery,
  blockNameOf,
  requireProviderCode,
  requireMethodFields,
  isPlainObject,
};
