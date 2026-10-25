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
const {
  PaymentMethod,
  CARD_ONLY_FIELDS,
  METHOD_BLOCK_FIELDS,
  normalizePaymentMethod,
  blockNameOf,
  requireProviderCode,
  requireMethodFields,
} = require('./payment-method-values');
const {
  requirePromissoryNoteSchedule,
  assertScheduleMatchesAmount,
  requireNoteCount,
  assertPromissoryNotePlan,
} = require('./promissory-note-values');

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

/**
 * Body of `POST /api/v1/payments/intents` (hosted checkout) and of
 * `payments.createMarketplaceIntent()`.
 *
 * `amount` is the only amount field: the basket total in minor units (integer,
 * at least 1), without any installment fee. With basket items, their `price`
 * values must add up to `amount`. The buyer picks the installment on the hosted
 * form; the system adds the installment fee to the charged amount.
 */
class CreateIntentRequest {
  constructor(amount, currency, orderId) {
    this.payload = { amount: requirePositiveMinor(amount, 'amount'), currency: normalizeCurrency(currency), orderId };
  }

  withCallbackUrl(value) { this.payload.callbackUrl = value; return this; }
  withDescription(value) { this.payload.description = value; return this; }
  withCustomerId(value) { this.payload.customerId = value; return this; }
  withCardUserKey(value) { this.payload.cardUserKey = value; return this; }
  withMethod(value) { this.payload.method = value; return this; }
  withPaymentMethod(value) { this.payload.paymentMethod = value; return this; }
  withWalletProvider(value) { this.payload.walletProvider = value; return this; }
  /**
   * Senetle Ödeme on the hosted form: your schedule of notes (`[{ amount,
   * dueDate }]`, amounts in minor units adding up to `amount`, `YYYY-MM-DD`
   * dates in ascending order, at most 24 rows). The form shows the plan and the
   * buyer does not choose a note count. Without it the buyer picks the number
   * of notes within your provider connection limits. Only with no
   * `paymentMethod` or with `PROMISSORY_NOTE`.
   */
  withPromissoryNoteSchedule(schedule) {
    this.payload.promissoryNote = { schedule: requirePromissoryNoteSchedule(schedule) };
    return this;
  }
  withForce3D(value) { this.payload.force3D = Boolean(value); return this; }
  /**
   * Pre-authorization. `true` holds the amount on the card and the payment
   * becomes `AUTHORIZED`; take it later with `payments.capture()` or release it
   * with `payments.void()`. `false` (or not calling this) captures immediately.
   * Also used by `payments.createMarketplaceIntent()`.
   */
  withPreauth(value) { this.payload.preauth = requirePreauth(value); return this; }
  withSettings(value) { this.payload.settings = value; return this; }
  withPaymentChannel(value) { this.payload.paymentChannel = value; return this; }
  withPaymentGroup(value) { this.payload.paymentGroup = value; return this; }
  withBuyer(value) { this.payload.buyer = toPlain(value); return this; }
  withBillingAddress(value) { this.payload.billingAddress = toPlain(value); return this; }
  withShippingAddress(value) { this.payload.shippingAddress = toPlain(value); return this; }
  withBasketItems(value) { this.payload.basketItems = value.map(toPlain); return this; }
  withMetadata(value) { this.payload.metadata = value; return this; }

  toJSON() {
    if (this.payload.promissoryNote) {
      if (this.payload.paymentMethod !== undefined && this.payload.paymentMethod !== null
        && this.payload.paymentMethod !== PaymentMethod.PROMISSORY_NOTE) {
        throw new ConfigurationError(`A promissory-note schedule cannot be sent with paymentMethod ${this.payload.paymentMethod}.`);
      }
      assertScheduleMatchesAmount(this.payload.promissoryNote.schedule, this.payload.amount);
    }
    return compact(this.payload);
  }
}

/**
 * Body of `POST /api/v1/payments/direct/payment` (`payments.directMethodPayment()`):
 * a payment with any payment method, started from the merchant server.
 *
 * Choose the method with exactly one of:
 *   - `withMethodFields(method, providerCode, fields)` for a method other than
 *     card (Faturana Yansıt, wallets …). The fields are the provider's
 *     `inputFields` from `payments.listPaymentMethods()`; `providerCode` may be
 *     `null` when the method's `providerSelection` is `OPTIONAL` (on a
 *     `providerSelectionMode: PLATFORM` method the platform then picks it).
 *     Senetle Ödeme (`PROMISSORY_NOTE`) also needs the plan:
 *     `withPromissoryNoteSchedule(schedule)` or `withPromissoryNoteCount(count)`.
 *   - `withCard(card)` for a card: the only server-side card charge. Without
 *     `withForce3D()` it is charged without 3D Secure (the bank may still ask
 *     for it: the response then carries a `REDIRECT` action);
 *     `withForce3D(true)` charges with 3D Secure and the response carries a
 *     `REDIRECT` action. A stored card is charged with `cardUserKey` +
 *     `cardToken` in `CardDetails`.
 *
 * Order fields: buyer, billingAddress, shippingAddress, basketItems,
 * paymentChannel, paymentGroup, description, customerId, metadata. `amount` is the
 * only amount field: the basket total in minor units (integer, at least 1),
 * without any installment fee; basket item `price` values must add up to it.
 */
class DirectMethodPaymentRequest {
  constructor(amount, currency, orderId) {
    this.payload = {
      amount: requirePositiveMinor(amount, 'amount'),
      currency: requireText(normalizeCurrency(currency), 'currency'),
      orderId: requireText(orderId, 'orderId'),
    };
    this.paymentMethod = null;
    this.block = null;
    this.promissoryNotePlan = null;
  }

  /**
   * Pays with a method other than card. `fields` are the provider's
   * `inputFields` values (e.g. `{ gsmNumber: '+905321234567' }` for Faturana
   * Yansıt); `{}` when the provider asks for nothing or the value comes from
   * `buyer` (`prefill`). `providerCode` is required when the method lists more
   * than one provider (`providerSelection: REQUIRED`).
   */
  withMethodFields(paymentMethod, providerCode, fields = {}) {
    const code = normalizePaymentMethod(paymentMethod);
    if (code === PaymentMethod.CARD) {
      throw new ConfigurationError('Use withCard(card) to pay by card.');
    }
    const blockName = blockNameOf(code);
    if (!METHOD_BLOCK_FIELDS.includes(blockName)) {
      throw new ConfigurationError(`paymentMethod ${code} cannot be paid through direct/payment yet; payments.listPaymentMethods() lists the methods that can.`);
    }
    const block = requireMethodFields(fields, blockName);
    if (code === PaymentMethod.PROMISSORY_NOTE && block.schedule !== undefined) {
      throw new ConfigurationError('Pass the promissory-note schedule with withPromissoryNoteSchedule(schedule), not in the fields.');
    }
    if (code === PaymentMethod.PROMISSORY_NOTE && block.noteCount !== undefined) {
      block.noteCount = requireNoteCount(block.noteCount);
    }
    this.paymentMethod = code;
    this.block = providerCode === null || providerCode === undefined
      ? block
      : { providerCode: requireProviderCode(providerCode), ...block };
    return this;
  }

  /**
   * Senetle Ödeme plan: one note per row, `[{ amount, dueDate }]`. Amounts are
   * positive integers in minor units adding up to `amount`; due dates are
   * `YYYY-MM-DD` (Istanbul calendar), after today, in ascending order, at most
   * 24 rows. Use with `withMethodFields(PaymentMethod.PROMISSORY_NOTE, …)`;
   * replaces a note count.
   */
  withPromissoryNoteSchedule(schedule) {
    this.promissoryNotePlan = { schedule: requirePromissoryNoteSchedule(schedule) };
    return this;
  }

  /**
   * Senetle Ödeme plan: the number of notes (1–24, within your provider
   * connection limits; the `noteCount` options in `inputFields`). The amount is
   * split evenly, the remaining minor units go to the last note; due dates
   * follow your connection settings. Replaces a schedule.
   */
  withPromissoryNoteCount(count) {
    this.promissoryNotePlan = { noteCount: requireNoteCount(count) };
    return this;
  }

  /** Pays by card (`CardDetails`: new card fields, or `cardUserKey` + `cardToken` for a stored card). */
  withCard(card) {
    const plain = toPlain(card);
    if (!plain || typeof plain !== 'object' || Array.isArray(plain) || Object.keys(plain).length === 0) {
      throw new ConfigurationError('withCard requires a non-empty CardDetails.');
    }
    this.paymentMethod = PaymentMethod.CARD;
    this.block = { ...plain };
    return this;
  }

  /**
   * Card only. `quoteToken` binds the charge to a quote from
   * `payments.installmentOptions()`; the system adds the quoted installment fee
   * to `amount`.
   */
  withInstallment(value, quoteToken = null) {
    this.payload.installment = requireInteger(value, 'installment');
    if (quoteToken !== null && quoteToken !== undefined) this.payload.installmentQuoteToken = requireText(quoteToken, 'installmentQuoteToken');
    return this;
  }

  /** Card only. `true` charges with 3D Secure: the response carries a `REDIRECT` action. */
  withForce3D(value) {
    if (typeof value !== 'boolean') throw new ConfigurationError(`force3D must be a boolean; got ${JSON.stringify(value)}.`);
    this.payload.force3D = value;
    return this;
  }

  /**
   * Pre-authorization. `true` holds the amount and the payment becomes
   * `AUTHORIZED`; take it with `payments.capture()` or release it with
   * `payments.void()`. A method whose providers do not support it
   * (`preauth: false` in `payments.listPaymentMethods()`) is refused with 422
   * `payment.preauth.unsupported_for_method`.
   */
  withPreauth(value) { this.payload.preauth = requirePreauth(value); return this; }
  /** Where the buyer's browser returns after a `REDIRECT` action, with the signed result form. */
  withCallbackUrl(value) { this.payload.callbackUrl = requireText(value, 'callbackUrl'); return this; }
  withLocale(value) { this.payload.locale = requireText(value, 'locale'); return this; }
  withDescription(value) { this.payload.description = value; return this; }
  withCustomerId(value) { this.payload.customerId = value; return this; }
  withPaymentChannel(value) { this.payload.paymentChannel = value; return this; }
  withPaymentGroup(value) { this.payload.paymentGroup = value; return this; }
  withBuyer(value) { this.payload.buyer = toPlain(value); return this; }
  withBillingAddress(value) { this.payload.billingAddress = toPlain(value); return this; }
  withShippingAddress(value) { this.payload.shippingAddress = toPlain(value); return this; }
  withBasketItems(value) {
    if (!Array.isArray(value)) throw new ConfigurationError('basketItems must be an array.');
    this.payload.basketItems = value.map(toPlain);
    return this;
  }
  withMetadata(value) { this.payload.metadata = value; return this; }

  toJSON() {
    if (!this.paymentMethod) {
      throw new ConfigurationError('Choose the payment method with withMethodFields(method, providerCode, fields) or withCard(card).');
    }
    if (this.paymentMethod !== PaymentMethod.CARD) {
      const cardField = CARD_ONLY_FIELDS.find((field) => this.payload[field] !== undefined);
      if (cardField) throw new ConfigurationError(`${cardField} can only be sent with a card payment (withCard).`);
    }
    const block = { ...this.block };
    if (this.paymentMethod === PaymentMethod.PROMISSORY_NOTE) {
      if (this.promissoryNotePlan) {
        if (block.noteCount !== undefined) {
          throw new ConfigurationError('The promissory-note plan is given twice: noteCount in the fields and withPromissoryNoteSchedule()/withPromissoryNoteCount(). Use one.');
        }
        Object.assign(block, this.promissoryNotePlan);
      }
      assertPromissoryNotePlan(block, this.payload.amount);
    } else if (this.promissoryNotePlan) {
      throw new ConfigurationError('A promissory-note plan can only be sent with paymentMethod PROMISSORY_NOTE.');
    }
    return compact({
      paymentMethod: this.paymentMethod,
      ...this.payload,
      [blockNameOf(this.paymentMethod)]: block,
    });
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

/**
 * Amount fields the gateway removed: `amount` is the only amount field of the
 * intent, marketplace and `direct/payment` bodies. A body that
 * still carries one of these is refused with 400 `payment.amount.field_removed`
 * (any value, `null` included), so the SDK refuses it before sending. A basket
 * item keeps its own `price`.
 */
const REMOVED_AMOUNT_FIELDS = Object.freeze(['price', 'paidPrice']);

function assertNoRemovedAmountFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const sent = REMOVED_AMOUNT_FIELDS.filter((field) => body[field] !== undefined);
  if (sent.length > 0) {
    throw new ConfigurationError(`${sent.join(', ')}: removed from the payment body; send the amount only in 'amount' (minor units, the basket total without the installment fee).`);
  }
}

/**
 * `preauth` is a money instruction: only a real boolean is sent. A string such
 * as "false" would otherwise reach the gateway and be refused with 400.
 */
function requirePreauth(value) {
  if (typeof value !== 'boolean') {
    throw new ConfigurationError(`preauth must be a boolean (true = pre-authorization, false = immediate capture); got ${JSON.stringify(value)}.`);
  }
  return value;
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

function requirePositiveMinor(value, field) {
  if (requireMinor(value, field) < 1) {
    throw new ConfigurationError(`${field} must be a positive amount in minor units; got ${JSON.stringify(value)}.`);
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
  DirectMethodPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  CreatePaymentLinkRequest,
  toPlain,
  isoOrNull,
  requirePreauth,
  REMOVED_AMOUNT_FIELDS,
  assertNoRemovedAmountFields,
};
