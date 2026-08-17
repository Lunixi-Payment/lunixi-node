'use strict';

const { CardDetails, DirectPaymentRequest } = require('../../src');
const { sampleClient, idempotencyKey, sampleBuyer, sampleBillingAddress, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const amount = 10050;
  const orderId = `ORD-DIRECT-3D-${Date.now()}`;
  const request = new DirectPaymentRequest(
    amount,
    'TRY',
    orderId,
    new CardDetails({
      cardHolderName: 'Ada Yilmaz',
      cardNumber: '5400000000000004',
      expireMonth: '12',
      expireYear: '28',
      cvcNumber: '123',
    }),
    sampleBuyer(),
    sampleBillingAddress(),
    sampleBasketItems(amount),
  )
    .withCallbackUrl('https://merchant.example/payment/3ds/callback')
    .withPaymentChannel('WEB')
    .withPaymentGroup('PRODUCT')
    .withDescription('Demo direct 3D payment');

  print(await sampleClient().payments.chargeCard3d(request, idempotencyKey('direct-3d')));
})();
