'use strict';

const { ConfigurationError } = require('../errors');

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
  toPlain,
};
