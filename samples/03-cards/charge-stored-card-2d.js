'use strict';

const { CardDetails, DirectPaymentRequest } = require('../../src');
const { sampleClient, requiredEnv, env, idempotencyKey, sampleBuyer, sampleBillingAddress, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const amount = 10050;
  const orderId = `ORD-STORED-CARD-${Date.now()}`;
  const request = new DirectPaymentRequest(
    amount,
    'TRY',
    orderId,
    new CardDetails({
      cardUserKey: env('LUNIXI_CARD_USER_KEY', 'cust_demo_001'),
      cardToken: requiredEnv('LUNIXI_STORED_CARD_TOKEN'),
      cvcNumber: env('LUNIXI_CARD_CVC', '123'),
    }),
    sampleBuyer(),
    sampleBillingAddress(),
    sampleBasketItems(amount),
  )
    .withPaymentChannel('WEB')
    .withPaymentGroup('PRODUCT')
    .withDescription('Demo stored-card payment')
    .withCustomerId(env('LUNIXI_CUSTOMER_ID', 'cust_demo_001'));

  print(await sampleClient().payments.chargeCard2d(request, idempotencyKey('stored-card-2d')));
})();
