'use strict';

const { sampleClient, env, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.listStoredCards(env('LUNIXI_CARD_USER_KEY', 'cust_demo_001')));
})();
