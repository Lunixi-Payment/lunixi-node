'use strict';

const { CardDetails, StoreCardRequest } = require('../../src');
const { sampleClient, env, idempotencyKey, print } = require('../_common/bootstrap');

(async () => {
  const request = new StoreCardRequest(
    new CardDetails({
      cardHolderName: 'Ada Yilmaz',
      cardNumber: '5400000000000004',
      expireMonth: '12',
      expireYear: '28',
      cvcNumber: '123',
    }),
    env('LUNIXI_CARD_USER_KEY', 'cust_demo_001'),
    'https://merchant.example/cards/3ds/callback',
  ).withCurrency('TRY');

  print(await sampleClient().payments.storeCard(request, idempotencyKey('store-card')));
})();
