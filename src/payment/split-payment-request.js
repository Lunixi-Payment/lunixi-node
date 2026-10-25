'use strict';

const { ConfigurationError } = require('../errors');
const {
  PaymentMethod,
  normalizePaymentMethod,
  blockNameOf,
  requireProviderCode,
  requireMethodFields,
  METHOD_BLOCK_FIELDS,
} = require('./payment-method-values');
const { assertSplitPaymentPayload } = require('./split-payment-values');
const { requireNoteCount } = require('./promissory-note-values');

/**
 * Body of `POST /payments/split` (`payments.createSplitPayment()`): one payment
 * funded by several legs.
 *
 *   - `addCardLeg(cardToken, amount, options)`: a stored card of `ownerRef`
 *     (`options.force3D` for 3D Secure, `options.installment` +
 *     `options.installmentQuoteToken` for installments; the quote comes from
 *     `payments.installmentOptions()` with this leg's amount).
 *   - `addMethodLeg(paymentMethod, providerCode, amount, fields)`: a non-card
 *     method with the same block as `direct/payment`. `providerCode` is
 *     required: a provider with `splitEligible: true` from
 *     `payments.listPaymentMethods()`. A promissory-note leg gives the number
 *     of notes as `noteCount` in `fields` (no schedule).
 *
 * The leg amounts are minor units and must add up to `totalAmount`. The order
 * in which you add the legs does not matter: the platform sets the order of
 * the steps.
 */
class SplitPaymentRequest {
  constructor(totalAmount, currency, ownerRef) {
    this.payload = {
      totalAmount,
      currency: String(currency || '').toUpperCase(),
      ownerRef,
    };
    this.legs = [];
  }

  /** Your order reference. */
  withOrderId(value) { this.payload.orderId = value; return this; }

  /** Where the buyer returns after a card leg's 3D Secure step. Required when a card leg sets `force3D`. */
  withCallbackUrl(value) { this.payload.callbackUrl = value; return this; }

  /** A stored card leg (`cardToken` of a card saved for `ownerRef`). */
  addCardLeg(cardToken, amount, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new ConfigurationError('addCardLeg options must be an object: { force3D, installment, installmentQuoteToken }.');
    }
    const unknown = Object.keys(options).filter((key) => !['force3D', 'installment', 'installmentQuoteToken'].includes(key));
    if (unknown.length > 0) throw new ConfigurationError(`Unknown card leg option(s): ${unknown.join(', ')}.`);
    const leg = { cardToken, amount };
    for (const key of ['force3D', 'installment', 'installmentQuoteToken']) {
      if (options[key] !== undefined && options[key] !== null) leg[key] = options[key];
    }
    this.legs.push(leg);
    return this;
  }

  /**
   * A non-card leg. `fields` are the provider's `inputFields` values (for
   * Faturana Yansıt `{ gsmNumber }`), as in `DirectMethodPaymentRequest.withMethodFields()`.
   */
  addMethodLeg(paymentMethod, providerCode, amount, fields = {}) {
    const code = normalizePaymentMethod(paymentMethod);
    if (code === PaymentMethod.CARD) throw new ConfigurationError('Use addCardLeg(cardToken, amount) for a card leg.');
    if (providerCode === null || providerCode === undefined) {
      throw new ConfigurationError('providerCode is required in a split payment leg (a provider with splitEligible: true from payments.listPaymentMethods()).');
    }
    const blockName = blockNameOf(code);
    if (!METHOD_BLOCK_FIELDS.includes(blockName)) {
      throw new ConfigurationError(`paymentMethod ${code} cannot be a split payment leg; a non-card leg carries one of the blocks ${METHOD_BLOCK_FIELDS.join(', ')}.`);
    }
    const block = { providerCode: requireProviderCode(providerCode), ...requireMethodFields(fields, blockName) };
    if (code === PaymentMethod.PROMISSORY_NOTE && block.noteCount !== undefined) {
      block.noteCount = requireNoteCount(block.noteCount, `${blockName}.noteCount`);
    }
    this.legs.push({ paymentMethod: code, amount, [blockName]: block });
    return this;
  }

  toJSON() {
    const body = { ...this.payload, legs: this.legs.map((leg) => ({ ...leg })) };
    for (const key of ['orderId', 'callbackUrl']) {
      if (body[key] === undefined || body[key] === null) delete body[key];
    }
    assertSplitPaymentPayload(body);
    return body;
  }
}

module.exports = { SplitPaymentRequest };
