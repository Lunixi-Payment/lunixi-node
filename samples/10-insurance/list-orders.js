'use strict';

/**
 * Your insurance orders, newest first, with the four status axes. Filter by
 * `paymentIntentId` or `merchantOrderId` to find the orders of one checkout.
 */

const { sampleClient, env, print } = require('../_common/bootstrap');

(async () => {
  const merchantOrderId = env('LUNIXI_MERCHANT_ORDER_ID');
  const filters = { limit: 50, ...(merchantOrderId ? { merchantOrderId } : {}) };

  for await (const order of sampleClient().insurance.iterateOrders(filters)) {
    print({
      orderId: order.orderId,
      merchantOrderId: order.merchantOrderId,
      status: order.status,
      collectionStatus: order.collectionStatus,
      policyStatus: order.policyStatus,
      refundStatus: order.refundStatus,
      premiumAmount: order.premiumAmount,
      policies: order.policies.map(({ policyId, policyNumber, policyStatus }) => ({ policyId, policyNumber, policyStatus })),
    });
  }
})();
