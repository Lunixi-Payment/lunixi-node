'use strict';

const crypto = require('node:crypto');
const { inspect } = require('node:util');
const { ConfigurationError } = require('../errors');

const HOSTED_URL = /^https:\/\/pay\.lunixi\.com\/payment\/[A-Za-z0-9._~-]{16,4096}$/;
const LABELS = Object.freeze({
  en: { title: 'Pay securely with Lunixi', pending: 'Payment confirmation is pending. Please check your order.' },
  tr: { title: 'Lunixi ile güvenle ödeyin', pending: 'Ödeme onayı bekleniyor. Lütfen siparişinizi kontrol edin.' },
});

/** Validates a backend URL without rebuilding or normalizing its opaque token. */
function validatePaymentPageUrl(value) {
  // JS `$` also matches before a final newline; require the entire match.
  if (typeof value !== 'string' || HOSTED_URL.exec(value)?.[0] !== value) {
    throw new ConfigurationError('A valid backend paymentPageUrl is required for hosted checkout.');
  }
  return value;
}

/** Browser capability: disclose only after native order ownership and CSRF checks. */
class CheckoutForm {
  #intent;

  constructor(response) {
    const value = response && typeof response.data === 'object' && response.data !== null && !Array.isArray(response.data)
      ? response.data : response;
    if (!value || typeof value !== 'object' || Array.isArray(value) || response.success === false || value.success === false
      || typeof value.paymentId !== 'string' || !value.paymentId || value.paymentId.length > 191
      || typeof value.token !== 'string' || !value.token || value.token.length > 16384) {
      throw new ConfigurationError('Uncertain checkout response; reconcile the original payment attempt.');
    }
    for (const alias of ['intentId', 'id']) {
      if (Object.hasOwn(value, alias) && value[alias] !== value.paymentId) {
        throw new ConfigurationError('Conflicting checkout identities; reconcile the original payment attempt.');
      }
    }
    const paymentPageUrl = value.paymentPageUrl === undefined || value.paymentPageUrl === null || value.paymentPageUrl === ''
      ? undefined : validatePaymentPageUrl(value.paymentPageUrl);
    this.#intent = Object.freeze({ paymentId: value.paymentId, token: value.token, paymentPageUrl });
    Object.freeze(this);
  }

  get paymentId() { return this.#intent.paymentId; }
  get token() { return this.#intent.token; }
  get paymentPageUrl() { return this.#intent.paymentPageUrl; }

  /** Optional redirect; missing legacy URLs never fall back to the embedded token. */
  hostedUrl() {
    if (!this.paymentPageUrl) throw new ConfigurationError('Backend paymentPageUrl is unavailable; do not rebuild a URL or create another intent.');
    return this.paymentPageUrl;
  }

  /** Concrete merchant-site form page, using only the official browser SDK. */
  embeddedPage(locale = 'en') {
    if (!Object.hasOwn(LABELS, locale)) throw new ConfigurationError('Checkout locale must be en or tr.');
    const nonce = crypto.randomBytes(24).toString('base64');
    const label = LABELS[locale];
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        // Other provider/frame/connect directives belong to the merchant's
        // reviewed payment-method CSP; do not break issuer 3DS navigation here.
        'Content-Security-Policy': `script-src 'nonce-${nonce}' https://cdn.lunixi.com; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`,
      },
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label.title}</title></head><body><main><h1>${label.title}</h1><div id="lunixi-checkout-form" data-token="${escapeAttribute(this.token)}"></div><p id="lunixi-error" hidden>${label.pending}</p></main><script nonce="${nonce}" src="https://cdn.lunixi.com/lunixi-checkout.min.js" defer></script><script nonce="${nonce}" defer>window.addEventListener('DOMContentLoaded',async function(){try{const target=document.getElementById('lunixi-checkout-form');const checkout=await window.Lunixi.checkout.create({type:'payment',target:'lunixi-checkout-form',options:{token:target.dataset.token}});checkout.mount('#lunixi-checkout-form');}catch(_){document.getElementById('lunixi-error').hidden=false;}});</script></body></html>`,
    };
  }

  toJSON() { return { paymentId: this.paymentId, token: '[REDACTED]', paymentPageUrl: '[REDACTED]' }; }
  toString() { return `CheckoutForm[paymentId=${this.paymentId}, browserCapabilities=[REDACTED]]`; }
  [inspect.custom]() { return this.toString(); }
}

function escapeAttribute(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

module.exports = { CheckoutForm, validatePaymentPageUrl };
