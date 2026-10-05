'use strict';

const { ConfigurationError } = require('../errors');
const {
  PaymentLinkUsage,
  PaymentLinkAmountMode,
  PaymentLinkEnvironment,
  PaymentLinkDeliveryChannel,
  PaymentLinkButtonLabel,
  PaymentLinkLocale,
  BuyerFieldRequirement,
  CustomFieldType,
  ASSET_ID_PATTERN,
} = require('./payment-link-values');

/** Keys of the nested objects of a payment link, as the gateway DTO declares them. */
const BUYER_FIELD_KEYS = ['name', 'email', 'phone', 'address', 'identityNumber'];
const RECIPIENT_KEYS = ['name', 'email', 'phone'];
const PREFILL_KEYS = ['name', 'surname', 'email', 'phone', 'identityNumber', 'address', 'city', 'country', 'zipCode'];

class CardDetails {
  constructor(fields = {}) {
    this.fields = compact(fields);
  }

  toJSON() {
    return { ...this.fields };
  }
}

class Buyer {
  constructor(fields = {}) {
    this.fields = compact(fields);
  }

  toJSON() {
    return { ...this.fields };
  }
}

class Address {
  constructor(fields = {}) {
    this.fields = compact(fields);
  }

  toJSON() {
    return { ...this.fields };
  }
}

class BasketItem {
  static TYPE_PHYSICAL = 'PHYSICAL';
  static TYPE_VIRTUAL = 'VIRTUAL';

  constructor(fields = {}) {
    this.fields = compact(fields);
  }

  toJSON() {
    return { ...this.fields };
  }
}

class CreateIntentRequest {
  constructor(amount, currency, orderId) {
    this.payload = { amount, currency: normalizeCurrency(currency), orderId };
  }

  withPrice(value) { this.payload.price = value; return this; }
  withPaidPrice(value) { this.payload.paidPrice = value; return this; }
  withInstallment(value) { this.payload.installment = value; return this; }
  withCallbackUrl(value) { this.payload.callbackUrl = value; return this; }
  withDescription(value) { this.payload.description = value; return this; }
  withCustomerId(value) { this.payload.customerId = value; return this; }
  withCardUserKey(value) { this.payload.cardUserKey = value; return this; }
  withMethod(value) { this.payload.method = value; return this; }
  withPaymentMethod(value) { this.payload.paymentMethod = value; return this; }
  withWalletProvider(value) { this.payload.walletProvider = value; return this; }
  withForce3D(value) { this.payload.force3D = Boolean(value); return this; }
  withSettings(value) { this.payload.settings = value; return this; }
  withPaymentChannel(value) { this.payload.paymentChannel = value; return this; }
  withPaymentGroup(value) { this.payload.paymentGroup = value; return this; }
  withBuyer(value) { this.payload.buyer = toPlain(value); return this; }
  withBillingAddress(value) { this.payload.billingAddress = toPlain(value); return this; }
  withShippingAddress(value) { this.payload.shippingAddress = toPlain(value); return this; }
  withBasketItems(value) { this.payload.basketItems = value.map(toPlain); return this; }
  withMetadata(value) { this.payload.metadata = value; return this; }

  toJSON() {
    return compact(this.payload);
  }
}

class DirectPaymentRequest {
  constructor(paidPrice, currency, orderId, card, buyer, billingAddress, basketItems) {
    if (!Array.isArray(basketItems) || basketItems.length === 0) {
      throw new ConfigurationError('Direct payments require at least one basket item.');
    }
    this.payload = {
      paidPrice,
      currency: normalizeCurrency(currency),
      orderId,
      card: toPlain(card),
      buyer: toPlain(buyer),
      billingAddress: toPlain(billingAddress),
      basketItems: basketItems.map(toPlain),
    };
  }

  withPrice(value) { this.payload.price = value; return this; }
  withInstallment(value) { this.payload.installment = value; return this; }
  withCallbackUrl(value) { this.payload.callbackUrl = value; return this; }
  withDescription(value) { this.payload.description = value; return this; }
  withCustomerId(value) { this.payload.customerId = value; return this; }
  withCardUserKey(value) { this.payload.cardUserKey = value; return this; }
  withPaymentChannel(value) { this.payload.paymentChannel = value; return this; }
  withPaymentGroup(value) { this.payload.paymentGroup = value; return this; }
  withMetadata(value) { this.payload.metadata = value; return this; }

  toJSON() {
    return compact(this.payload);
  }
}

class InstallmentOptionsRequest {
  constructor(amount, currency) {
    this.payload = { amount, currency: normalizeCurrency(currency) };
  }

  withBinOrPan(value) { this.payload.binOrPan = value; return this; }
  withInstallment(value) { this.payload.installment = value; return this; }
  withCardBrand(value) { this.payload.cardBrand = value; return this; }

  toJSON() {
    return compact(this.payload);
  }
}

class StoreCardRequest {
  constructor(card, cardUserKey, callbackUrl) {
    this.payload = { card: toPlain(card), cardUserKey, callbackUrl };
  }

  withCurrency(value) { this.payload.currency = normalizeCurrency(value); return this; }

  toJSON() {
    return compact(this.payload);
  }
}

/**
 * One line of an ITEMIZED payment link.
 *
 * `itemKey` is the line's permanent identity: stock counters hang off it, so it
 * cannot be changed once the link exists. Leave it out and the server assigns
 * one (`it_…`).
 */
class PaymentLinkItem {
  constructor(name, unitPriceMinor) {
    this.payload = {
      name: requireText(name, 'PaymentLinkItem name'),
      unitPriceMinor: requireMinor(unitPriceMinor, 'unitPriceMinor'),
    };
  }

  withItemKey(value) { this.payload.itemKey = requireText(value, 'itemKey'); return this; }
  withDescription(value) { this.payload.description = String(value); return this; }
  /** Buyer-selectable quantity range for this line. `0` as the minimum makes the line optional. */
  withQuantityRange(minQuantity, maxQuantity) {
    this.payload.minQuantity = requireInteger(minQuantity, 'minQuantity');
    this.payload.maxQuantity = requireInteger(maxQuantity, 'maxQuantity');
    return this;
  }
  /** Units available for this line across all payments; `null` = unlimited. */
  withCapacity(value) { this.payload.capacity = nullableInteger(value, 'capacity'); return this; }
  /** Id of a published payment-link image asset of your organisation (uuid); `null` = none. */
  withImageAssetId(value) { this.payload.imageAssetId = nullableAssetId(value, 'imageAssetId'); return this; }

  toJSON() {
    return { ...this.payload };
  }
}

/** A typed question the buyer answers on the payment page (no file uploads). */
class PaymentLinkCustomField {
  constructor(key, label, fieldType) {
    this.payload = {
      key: requireText(key, 'custom field key'),
      label: requireText(label, 'custom field label'),
      fieldType: requireOneOf(fieldType, CustomFieldType, 'fieldType'),
    };
  }

  withRequired(value = true) { this.payload.required = Boolean(value); return this; }
  /** Choices of a `SELECT` field. */
  withOptions(values) { this.payload.options = requireStringArray(values, 'options'); return this; }
  withMaxLength(value) { this.payload.maxLength = requireInteger(value, 'maxLength'); return this; }
  withHelpText(value) { this.payload.helpText = String(value); return this; }

  toJSON() {
    return { ...this.payload };
  }
}

/**
 * Body of `POST /api/v1/payments/links`.
 *
 * Amounts are integers in the currency's minor unit (kuruş for TRY):
 * `150000` is 1,500.00 TRY. `usage`, `amountMode` and `currency` are fixed at
 * creation. The builder checks types and value sets; the business rules (title
 * length, amount ranges, which fields a mode allows) are enforced by the server,
 * which answers 422 `payment_link.validation.invalid` with `details.errors`.
 */
class CreatePaymentLinkRequest {
  /** A link for a set amount. */
  static fixed(usage, amountMinor, currency, title) {
    return new CreatePaymentLinkRequest(usage, PaymentLinkAmountMode.FIXED, currency, title)
      .withAmountMinor(amountMinor);
  }

  /**
   * A link where the buyer enters the amount (donations, deposits).
   * `minAmountMinor` is required; `maxAmountMinor` and up to six ascending
   * `suggestedAmountsMinor` are optional.
   */
  static open(usage, currency, title, { minAmountMinor, maxAmountMinor = null, suggestedAmountsMinor = null } = {}) {
    const request = new CreatePaymentLinkRequest(usage, PaymentLinkAmountMode.OPEN, currency, title)
      .withMinAmountMinor(minAmountMinor);
    if (maxAmountMinor !== null && maxAmountMinor !== undefined) request.withMaxAmountMinor(maxAmountMinor);
    if (suggestedAmountsMinor) request.withSuggestedAmountsMinor(suggestedAmountsMinor);
    return request;
  }

  /** A link where the buyer picks quantities of the given lines (1–50 items). */
  static itemized(usage, currency, title, items) {
    return new CreatePaymentLinkRequest(usage, PaymentLinkAmountMode.ITEMIZED, currency, title)
      .withItems(items);
  }

  constructor(usage, amountMode, currency, title) {
    this.payload = {
      usage: requireOneOf(usage, PaymentLinkUsage, 'usage'),
      amountMode: requireOneOf(amountMode, PaymentLinkAmountMode, 'amountMode'),
      currency: requireText(normalizeCurrency(currency), 'currency'),
      title: requireText(title, 'title'),
    };
  }

  /**
   * Optional. The API key already decides the environment; when set, it must
   * equal the key's environment or the server answers 403
   * `payment_link.environment.mismatch`.
   */
  withEnvironment(value) { this.payload.environment = requireOneOf(value, PaymentLinkEnvironment, 'environment'); return this; }

  withAmountMinor(value) { this.payload.amountMinor = requireMinor(value, 'amountMinor'); return this; }
  withMinAmountMinor(value) { this.payload.minAmountMinor = requireMinor(value, 'minAmountMinor'); return this; }
  withMaxAmountMinor(value) { this.payload.maxAmountMinor = requireMinor(value, 'maxAmountMinor'); return this; }
  withSuggestedAmountsMinor(values) {
    if (!Array.isArray(values)) throw new ConfigurationError('suggestedAmountsMinor must be an array of minor-unit integers.');
    this.payload.suggestedAmountsMinor = values.map((value) => requireMinor(value, 'suggestedAmountsMinor[]'));
    return this;
  }

  /** Lets the buyer choose a quantity (FIXED + MULTI_USE only), 1..999. */
  withQuantity(minQuantity, maxQuantity) {
    this.payload.quantityEnabled = true;
    this.payload.minQuantity = requireInteger(minQuantity, 'minQuantity');
    this.payload.maxQuantity = requireInteger(maxQuantity, 'maxQuantity');
    return this;
  }

  withItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ConfigurationError('An ITEMIZED payment link needs at least one item.');
    }
    this.payload.items = items.map(toPlain);
    return this;
  }

  addItem(item) {
    this.payload.items = [...(this.payload.items || []), toPlain(item)];
    return this;
  }

  /** Total units the link can sell across all payments (MULTI_USE only); `null` = unlimited. */
  withCapacity(value) { this.payload.capacity = nullableInteger(value, 'capacity'); return this; }

  /** Plain text, shown as text (no HTML or Markdown). */
  withDescription(value) { this.payload.description = String(value); return this; }
  /** Id of a published payment-link image asset of your organisation (uuid); `null` = none. */
  withImageAssetId(value) { this.payload.imageAssetId = nullableAssetId(value, 'imageAssetId'); return this; }
  withSuccessMessage(value) { this.payload.successMessage = String(value); return this; }
  /** `https://` only. */
  withSuccessRedirectUrl(value) { this.payload.successRedirectUrl = value === null ? null : requireText(value, 'successRedirectUrl'); return this; }
  withTaxNote(value) { this.payload.taxNote = String(value); return this; }
  /** Language of the payment page: `tr` or `en` (`PaymentLinkLocale`). */
  withLocale(value) { this.payload.locale = requireOneOf(value, PaymentLinkLocale, 'locale'); return this; }

  withStartsAt(value) { this.payload.startsAt = isoOrNull(value, 'startsAt'); return this; }
  withExpiresAt(value) { this.payload.expiresAt = isoOrNull(value, 'expiresAt'); return this; }
  /** Display only (e.g. the event date of a ticket). */
  withEventAt(value) { this.payload.eventAt = isoOrNull(value, 'eventAt'); return this; }

  /** `PAY`, `DONATE`, `BUY` or `BOOK` (`PaymentLinkButtonLabel`); `null` = your organisation's default. */
  withButtonLabelKey(value) {
    this.payload.buttonLabelKey = value === null ? null : requireOneOf(value, PaymentLinkButtonLabel, 'buttonLabelKey');
    return this;
  }
  withTermsAcceptanceRequired(value = true) { this.payload.requireTermsAcceptance = Boolean(value); return this; }

  /** Each of `name`, `email`, `phone`, `address`, `identityNumber`: `HIDDEN` | `OPTIONAL` | `REQUIRED`. */
  withBuyerFields(value) {
    const fields = plainObject(value, 'buyerFields');
    if (fields !== null) {
      assertKeys(fields, BUYER_FIELD_KEYS, 'buyerFields');
      for (const [key, requirement] of Object.entries(fields)) requireOneOf(requirement, BuyerFieldRequirement, `buyerFields.${key}`);
    }
    this.payload.buyerFields = fields;
    return this;
  }

  withCustomFields(fields) {
    if (!Array.isArray(fields)) throw new ConfigurationError('customFields must be an array.');
    this.payload.customFields = fields.map(toPlain);
    return this;
  }

  addCustomField(field) {
    this.payload.customFields = [...(this.payload.customFields || []), toPlain(field)];
    return this;
  }

  /** Who the link is for (`name`, `email`, `phone` in E.164). Stored encrypted. */
  withRecipient(value) { this.payload.recipient = stringObject(value, RECIPIENT_KEYS, 'recipient'); return this; }
  /**
   * Buyer details filled in on the server side; never sent to the browser.
   * Keys: `name`, `surname`, `email`, `phone`, `identityNumber`, `address`,
   * `city`, `country` (ISO 3166-1 alpha-2), `zipCode`.
   */
  withPrefill(value) { this.payload.prefill = stringObject(value, PREFILL_KEYS, 'prefill'); return this; }

  /**
   * Requires the buyer to confirm a one-time code sent to `recipient.email`
   * before paying. Only `EMAIL` is available.
   */
  withVerification(required = true, channel = PaymentLinkDeliveryChannel.EMAIL) {
    this.payload.verification = {
      required: Boolean(required),
      channel: requireOneOf(channel, PaymentLinkDeliveryChannel, 'verification channel'),
    };
    return this;
  }

  /** Reminder e-mails (SINGLE_USE with a recipient): every 24–168 hours, at most 1–3 times. */
  withReminders(intervalHours, maxCount) {
    this.payload.reminders = {
      enabled: true,
      intervalHours: requireInteger(intervalHours, 'intervalHours'),
      maxCount: requireInteger(maxCount, 'maxCount'),
    };
    return this;
  }

  /**
   * Narrows the checkout: `requireThreeDs` can only tighten, `paymentMethods` is
   * a subset of your form settings (empty = your form settings).
   */
  withCheckout({ requireThreeDs = false, paymentMethods = [] } = {}) {
    this.payload.checkout = {
      requireThreeDs: Boolean(requireThreeDs),
      paymentMethods: requireStringArray(paymentMethods, 'paymentMethods'),
    };
    return this;
  }

  withReference(value) { this.payload.reference = String(value); return this; }
  withTags(values) { this.payload.tags = requireStringArray(values, 'tags'); return this; }
  withBranchCode(value) { this.payload.branchCode = String(value); return this; }
  withSalesChannel(value) { this.payload.salesChannel = String(value); return this; }
  withCampaign(value) { this.payload.campaign = String(value); return this; }
  withAgentCode(value) { this.payload.agentCode = String(value); return this; }
  withMerchantNotifyEmails(values) { this.payload.merchantNotifyEmails = requireStringArray(values, 'merchantNotifyEmails'); return this; }

  /** Up to 20 string key/value pairs returned to you in webhooks. */
  withMetadata(value) { this.payload.metadata = stringRecord(value, 'metadata'); return this; }

  toJSON() {
    return { ...this.payload };
  }
}

function requireOneOf(value, values, field) {
  const allowed = Object.values(values);
  if (!allowed.includes(value)) {
    throw new ConfigurationError(`${field} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new ConfigurationError(`${field} must be an integer; got ${JSON.stringify(value)}.`);
  }
  return value;
}

/** Money is an integer count of minor units. A decimal such as 1500.5 is a unit mix-up, not a price. */
function requireMinor(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new ConfigurationError(`${field} must be an integer amount in minor units (e.g. 150000 for 1,500.00 TRY); got ${JSON.stringify(value)}.`);
  }
  return value;
}

function nullableAssetId(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !ASSET_ID_PATTERN.test(value)) {
    throw new ConfigurationError(`${field} must be an asset id (uuid) or null; got ${JSON.stringify(value)}.`);
  }
  return value;
}

function nullableInteger(value, field) {
  return value === null ? null : requireInteger(value, field);
}

function requireStringArray(values, field) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new ConfigurationError(`${field} must be an array of strings.`);
  }
  return [...values];
}

function plainObject(value, field) {
  const plain = toPlain(value);
  if (plain === null) return null;
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) {
    throw new ConfigurationError(`${field} must be an object.`);
  }
  return { ...plain };
}

/** The gateway rejects a nested key its DTO does not declare with 400; name it here instead. */
function assertKeys(object, allowed, field) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`Unknown ${field} field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`);
  }
}

/** An object of string values with a closed key set (`recipient`, `prefill`); `null` clears it. */
function stringObject(value, allowed, field) {
  const object = plainObject(value, field);
  if (object === null) return null;
  assertKeys(object, allowed, field);
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry !== 'string') throw new ConfigurationError(`${field}.${key} must be a string.`);
  }
  return object;
}

function stringRecord(value, field) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new ConfigurationError(`${field} must be an object whose values are strings.`);
  }
  return { ...value };
}

/** Accepts a Date or an ISO-8601 string; `null` clears the value. */
function isoOrNull(value, field) {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ConfigurationError(`${field} is an invalid Date.`);
    return value.toISOString();
  }
  return requireText(value, field);
}

function toPlain(value) {
  if (value && typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

function compact(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

function normalizeCurrency(value) {
  return String(value || '').toUpperCase();
}

module.exports = {
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  CreatePaymentLinkRequest,
  toPlain,
  isoOrNull,
};
