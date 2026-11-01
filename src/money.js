'use strict';

const { ConfigurationError } = require('./errors');
const MAX_FIAT_MINOR = 9223372036854775807n;
const EXPONENTS = Object.freeze({ JPY: 0, KWD: 3, TRY: 2, USD: 2, EUR: 2, GBP: 2, RUB: 2, AED: 2, SAR: 2, QAR: 2, CHF: 2, CAD: 2, AUD: 2, CNY: 2, AZN: 2 });

/** Validate canonical fiat minor-unit text without coercion or floating-point arithmetic. */
function minor(value, field = 'amount', { positive = true, signed = false } = {}) {
  const pattern = signed ? /^(0|-?[1-9][0-9]*)$/ : positive ? /^[1-9][0-9]*$/ : /^(0|[1-9][0-9]*)$/;
  if (typeof value !== 'string' || value !== value.trim() || !pattern.test(value)) throw new ConfigurationError(`${field} must be a canonical string in minor units.`);
  const exact = BigInt(value);
  if (exact > MAX_FIAT_MINOR || exact < -MAX_FIAT_MINOR - 1n) throw new ConfigurationError(`${field} exceeds the signed 64-bit fiat range.`);
  return value;
}

/** Convert decimal text using the validated currency exponent; excess precision fails closed. */
function decimalToMinor(value, currency) {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) throw new ConfigurationError('Unsupported gateway currency.');
  if (typeof value !== 'string' || value !== value.trim() || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new ConfigurationError('Exact nonnegative decimal text is required.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) throw new ConfigurationError('Amount exceeds currency precision.');
  const text = (whole + fraction.slice(0, exponent).padEnd(exponent, '0')).replace(/^0+(?=[0-9])/, '');
  return minor(text, 'amount', { positive: false });
}

// Public gateway monetary fields. Arbitrary merchant metadata and provider input values are not DTOs.
const MONEY_FIELDS = new Set(['availableMinor', 'blockedMinor', 'availableWithoutOverdraftMinor', 'overdraftAvailableMinor', 'balanceAfterMinor', 'sourceBalanceAfterMinor', 'targetBalanceAfterMinor', 'amount', 'amountMinor', 'authorizedAmount', 'availableBalance', 'balanceMinor', 'buyerTotalCharge', 'cancelledPremiumAmount', 'capturedAmount', 'capturedAmountMinor', 'chargeAmount', 'collectedAmountMinor', 'collectedPremiumAmount', 'compensatedAmount', 'disputedAmount', 'feeTotal', 'fixedFee', 'inForcePremiumAmount', 'insuranceValueAmount', 'legAmount', 'legsAmount', 'lineTotalMinor', 'maxAmount', 'maxAmountMinor', 'minAmount', 'minAmountMinor', 'nonRefundableAmount', 'paidAmount', 'paidPrice', 'pendingBalance', 'premiumAmount', 'price', 'refundAmount', 'refundOpenPremiumAmount', 'refundableAmount', 'refundedAmount', 'refundedAmountMinor', 'refundedPremiumAmount', 'requestedAmount', 'reservedBalance', 'sourceAmountMinor', 'targetAmountMinor', 'taxAmountMinor', 'taxTotal', 'totalAmount', 'unitPriceMinor']);
const MONEY_CONTAINERS = new Set(['data', 'details', 'items', 'rows', 'results', 'payments', 'operations', 'balances', 'wallets', 'legs', 'aggregate', 'refund', 'refunds', 'totals', 'charge', 'fees', 'fee', 'balance', 'splits', 'sellers', 'basketItems', 'promissoryNote', 'schedule', 'notes', 'lines', 'offers', 'policies', 'reconciliation', 'quotes', 'payment', 'transactions', 'accounts', 'settlements', 'payouts', 'limits', 'options', 'quote']);
function validateMoneyFields(value, { response = false } = {}) {
  if (Array.isArray(value)) { value.forEach(entry => validateMoneyFields(entry, { response })); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value.toJSON === 'function') value = value.toJSON();
  for (const [key, entry] of Object.entries(value)) {
    if (['metadata', 'fields', 'inputFields', 'insuranceData'].includes(key) || entry === null || entry === undefined) continue;
    if (MONEY_FIELDS.has(key)) {
      minor(entry, key, { positive: !response && ['amount', 'price', 'totalAmount'].includes(key), signed: /balance|difference/i.test(key) });
    } else if (key === 'suggestedAmountsMinor') {
      if (!Array.isArray(entry)) throw new ConfigurationError('suggestedAmountsMinor must be an array.');
      entry.forEach(amount => minor(amount, key));
    } else if (MONEY_CONTAINERS.has(key)) validateMoneyFields(entry, { response });
  }
}
module.exports = { minor, decimalToMinor, validateMoneyFields };

/** Only the declared fiat API families use this signed-64 domain. */
function isFiatRoute(path) { return /^\/api\/v1\/(payments|wallet|insurance|bank-connect|fraud)(?:[/?]|$)/.test(path); }
module.exports.isFiatRoute = isFiatRoute;

/** Optional capture/refund amount is omitted, never JSON null. Other nullable DTO fields are unaffected. */
function validateOperationAmount(path, body) {
  if (/^\/api\/v1\/payments\/(?:split\/)?[^/]+\/(?:capture|refund)(?:[?]|$)/.test(path)
      && body && Object.prototype.hasOwnProperty.call(body, 'amount') && body.amount !== undefined) minor(body.amount);
}
module.exports.validateOperationAmount = validateOperationAmount;
