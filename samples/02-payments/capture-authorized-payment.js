'use strict';

const { sampleClient, requiredEnv, idempotencyKey, print } = require('../_common/bootstrap');

(async () => {
  const paymentId = requiredEnv('LUNIXI_PAYMENT_ID');
  print(await sampleClient().payments.capture(paymentId, null, idempotencyKey('capture')));
})();
