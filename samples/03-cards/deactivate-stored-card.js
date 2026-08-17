'use strict';

const { sampleClient, requiredEnv, idempotencyKey, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.deactivateStoredCard(
    requiredEnv('LUNIXI_STORED_CARD_TOKEN'),
    idempotencyKey('deactivate-card'),
  ));
})();
