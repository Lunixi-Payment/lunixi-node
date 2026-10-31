'use strict';

const { CheckoutForm, ConfigurationError } = require('../../src');

/** Native adapter is mandatory: no demo identity, memory ledger or browser totals. */
function createNativeCheckout(lunixi, native, now = () => Math.floor(Date.now() / 1000)) {
  if (!lunixi?.payments || typeof lunixi.payments.createIntent !== 'function') throw new ConfigurationError('A configured server Lunixi client is required.');
  for (const method of ['authenticate', 'verifyCsrf', 'reserveCheckout', 'bindCheckoutResponse', 'markCheckoutUncertain']) {
    if (!native || typeof native[method] !== 'function') throw new ConfigurationError(`Native checkout adapter must implement ${method}.`);
  }
  return async function checkout(request, orderId) {
    const principal = await native.authenticate(request);
    if (!principal) throw denied(401);
    if (await native.verifyCsrf(request, principal) !== true) throw denied(403);
    // Must load the owned server order, validate it and commit its immutable
    // attempt/request/key before returning. Browser amount/card/status ignored.
    const attempt = await native.reserveCheckout(principal, orderId);
    const body = attempt?.request;
    if (!body || !Number.isSafeInteger(body.amount) || body.amount < 1 || typeof body.orderId !== 'string' || !body.orderId
      || typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)
      || Object.hasOwn(body, 'price') || Object.hasOwn(body, 'paidPrice') || Object.hasOwn(body, 'card') || Object.hasOwn(body, 'paymentCards')
      || typeof attempt.key !== 'string' || !/^[\x21-\x7e]{16,128}$/.test(attempt.key)
      || !Number.isSafeInteger(attempt.createdAtSeconds) || !['reserved', 'pending'].includes(attempt.state)) {
      throw denied(409);
    }
    const mode = attempt.mode ?? 'embedded';
    const locale = attempt.locale ?? 'en';
    if (!['embedded', 'redirect'].includes(mode) || !['en', 'tr'].includes(locale)) throw denied(409);
    const age = now() - attempt.createdAtSeconds;
    if (!Number.isSafeInteger(age) || age < 0 || age >= (attempt.response ? 840 : 23 * 3600)) throw denied(409);
    let response = attempt.response;
    if (!response) {
      if (attempt.state !== 'reserved') throw denied(409);
      try {
        response = await lunixi.payments.createIntent(body, attempt.key);
        new CheckoutForm(response);
        // Atomically bind the same attempt/payment and encrypt the whole response,
        // including paymentPageUrl. Preserve any concurrent native winner.
        await native.bindCheckoutResponse(attempt, response);
      } catch (_) {
        await native.markCheckoutUncertain(attempt);
        throw denied(409);
      }
    }
    const form = new CheckoutForm(response);
    if (mode === 'redirect') {
      return { status: 303, headers: { Location: form.hostedUrl(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, body: '' };
    }
    return form.embeddedPage(locale);
  };
}

function denied(statusCode) {
  const error = new Error('Checkout is unavailable; check the original order.');
  error.statusCode = statusCode;
  return error;
}

module.exports = { createNativeCheckout };
