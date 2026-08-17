'use strict';

const { sampleClient, requiredEnv, env, idempotencyKey, print } = require('../_common/bootstrap');

(async () => {
  const paymentId = requiredEnv('LUNIXI_PAYMENT_ID');
  const amount = env('LUNIXI_REFUND_AMOUNT') ? Number(env('LUNIXI_REFUND_AMOUNT')) : null;
  print(await sampleClient().payments.refund(paymentId, amount, 'customer request', idempotencyKey('refund')));
})();
