'use strict';

// A stored card is charged through the common direct endpoint: cardUserKey +
// cardToken in the card block. Without withForce3D() it is charged without
// 3D Secure; the bank may still ask for it (the response then carries a
// REDIRECT action).

const { CardDetails, DirectMethodPaymentRequest } = require('../../src');
const { sampleClient, requiredEnv, env, idempotencyKey, sampleBuyer, sampleBillingAddress, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const amount = 10050;
  const orderId = `ORD-STORED-CARD-${Date.now()}`;
  const request = new DirectMethodPaymentRequest(amount, 'TRY', orderId)
    .withCard(new CardDetails({
      cardUserKey: env('LUNIXI_CARD_USER_KEY', 'cust_demo_001'),
      cardToken: requiredEnv('LUNIXI_STORED_CARD_TOKEN'),
      cvcNumber: env('LUNIXI_CARD_CVC', '123'),
    }))
    .withBuyer(sampleBuyer())
    .withBillingAddress(sampleBillingAddress())
    .withBasketItems(sampleBasketItems(amount))
    .withPaymentChannel('WEB')
    .withPaymentGroup('PRODUCT')
    .withDescription('Demo stored-card payment')
    .withCustomerId(env('LUNIXI_CUSTOMER_ID', 'cust_demo_001'));

  print(await sampleClient().payments.directMethodPayment(request, idempotencyKey('stored-card')));
})();
