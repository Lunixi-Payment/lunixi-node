'use strict';

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.get(requiredEnv('LUNIXI_PAYMENT_ID')));
})();
