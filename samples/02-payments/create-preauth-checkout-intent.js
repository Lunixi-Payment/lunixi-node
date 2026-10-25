'use strict';

// Pre-authorization: the amount is held on the card and the payment becomes
// AUTHORIZED. Take it with capture-authorized-payment.js or release it with
// void-authorized-payment.js (LUNIXI_PAYMENT_ID = the paymentId printed here).

const { CreateIntentRequest } = require('../../src');
const { sampleClient, idempotencyKey, sampleBuyer, sampleBillingAddress, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const amount = 10050;
  const orderId = `ORD-PREAUTH-${Date.now()}`;
  const request = new CreateIntentRequest(amount, 'TRY', orderId)
    .withPreauth(true)
    .withCallbackUrl('https://merchant.example/payment/callback')
    .withPaymentChannel('WEB')
    .withBuyer(sampleBuyer())
    .withBillingAddress(sampleBillingAddress())
    .withBasketItems(sampleBasketItems(amount));

  print(await sampleClient().payments.createIntent(request, idempotencyKey('preauth-checkout')));
})();
