'use strict';

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.getStoredCard(requiredEnv('LUNIXI_STORED_CARD_TOKEN')));
})();
