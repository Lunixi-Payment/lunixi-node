'use strict';

/**
 * An order whose premium you collected outside Lunixi (your own POS, bank
 * transfer …): record the payment, then request the policy. `paidAmount` and
 * `paidCurrency` must equal the order's premium. The policy result arrives by
 * the `insurance.policy.issued` or `insurance.policy.failed` webhook.
 *
 * LUNIXI_INSURANCE_ORDER_ID is an order created with `createOrder()` and not
 * bound to a Lunixi payment; LUNIXI_EXTERNAL_PAYMENT_ID is your own payment id.
 */

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');
const { ApiError } = require('../../src');

(async () => {
  const insurance = sampleClient().insurance;
  const orderId = requiredEnv('LUNIXI_INSURANCE_ORDER_ID');
  const externalPaymentId = requiredEnv('LUNIXI_EXTERNAL_PAYMENT_ID');

  try {
    const order = await insurance.getOrder(orderId);
    await insurance.confirmPayment(orderId, {
      externalPaymentId,
      paidAmount: order.premiumAmount,
      paidCurrency: order.currency,
      paidAt: new Date(),
    }, `ins-confirm:${externalPaymentId}`);

    const requested = await insurance.issuePolicy(orderId, `ins-issue:${orderId}`);
    print({ orderId, collectionStatus: requested.collectionStatus, policyStatus: requested.policyStatus });
  } catch (error) {
    // e.g. 409 insurance.order.state_conflict (details.reason lunixi_payment) or
    // 422 insurance.validation.invalid (premium_amount_mismatch).
    if (error instanceof ApiError) {
      print({ status: error.statusCode, code: error.code, details: error.response?.details ?? null });
      return;
    }
    throw error;
  }
})();
