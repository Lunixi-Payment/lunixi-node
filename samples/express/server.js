"use strict";

const express = require('express');
const { createNativeCheckout } = require('../_common/native-checkout');

/** Mount into the merchant app with its real auth, CSRF and durable order adapter. */
function createCheckoutApp({ lunixi, nativeCheckout }) {
  const checkout = createNativeCheckout(lunixi, nativeCheckout);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.use(express.json({ limit: '8kb' }));
  app.post('/orders/:orderId/checkout', async (req, res, next) => {
    try {
      const page = await checkout(req, req.params.orderId);
      res.status(page.status).set(page.headers).send(page.body);
    } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => {
    void req; void next;
    const status = [401, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 409;
    res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .json({ code: 'checkout_unavailable' });
  });
  return app;
}

// No demo credentials, fake customer or implicit in-memory financial store.
// Standalone direct API examples remain in samples/02-payments.
module.exports = { createCheckoutApp };
