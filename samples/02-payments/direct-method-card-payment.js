'use strict';

// A card from the merchant server: the common direct endpoint is the only
// server-side card charge. withForce3D(true) makes it a 3D Secure payment and
// the response then carries a REDIRECT action (send the buyer to
// data.action.redirect.url). Without withForce3D() the card is charged without
// 3D Secure (the bank may still ask for it with the same REDIRECT action).

const { CardDetails, DirectMethodPaymentRequest } = require('../../src');
const { sampleClient, idempotencyKey, sampleBuyer, sampleBillingAddress, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const amount = 10050;
  const request = new DirectMethodPaymentRequest(amount, 'TRY', `ORD-DMP-CARD-${Date.now()}`)
    .withCard(new CardDetails({
      cardHolderName: 'Ada Yilmaz',
      cardNumber: '5400000000000004',
      expireMonth: '12',
      expireYear: '28',
      cvcNumber: '123',
    }))
    .withForce3D(true)
    .withCallbackUrl('https://merchant.example/payment/callback')
    .withBuyer(sampleBuyer())
    .withBillingAddress(sampleBillingAddress())
    .withBasketItems(sampleBasketItems(amount));

  print(await sampleClient().payments.directMethodPayment(request, idempotencyKey('direct-method-card')));
})();
