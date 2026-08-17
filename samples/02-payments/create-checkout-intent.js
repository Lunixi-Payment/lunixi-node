'use strict';

const { CreateIntentRequest } = require('../../src');
const { sampleClient, idempotencyKey, sampleBuyer, sampleBillingAddress, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const amount = 10050;
  const orderId = `ORD-CHECKOUT-${Date.now()}`;
  const request = new CreateIntentRequest(amount, 'TRY', orderId)
    .withCallbackUrl('https://merchant.example/payment/callback')
    .withPaymentChannel('WEB')
    .withPaymentGroup('PRODUCT')
    .withBuyer(sampleBuyer())
    .withBillingAddress(sampleBillingAddress())
    .withBasketItems(sampleBasketItems(amount))
    .withSettings({
      paymentMethods: ['card'],
      threeD: { mode: 'auto', forceAmountMinor: '500000' },
      buyerProtection: { enabled: false },
    });

  print(await sampleClient().payments.createIntent(request, idempotencyKey('checkout')));
})();
