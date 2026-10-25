'use strict';

/**
 * Cancels the policies of an order, then refunds the premium. Cancellation is
 * asynchronous (`CANCEL_PENDING`, confirmed by `insurance.policy.cancelled`)
 * and does not refund anything by itself. With a Lunixi payment the premium is
 * refunded from that payment (`refundStatus: PENDING`, then
 * `insurance.refund.completed`); for a premium collected outside Lunixi you
 * report the refund you made with `externalRefund`.
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');
const { InsurancePaymentMode, InsurancePolicyStatus, ApiError } = require('../../src');

(async () => {
  const insurance = sampleClient().insurance;
  const orderId = requiredEnv('LUNIXI_INSURANCE_ORDER_ID');

  try {
    const cancelled = await insurance.cancelOrder(orderId, `ins-cancel:${orderId}`);
    print({ orderId, policyStatus: cancelled.policyStatus });

    if (cancelled.policyStatus !== InsurancePolicyStatus.CANCELLED) {
      // Run again after the insurance.policy.cancelled webhook.
      return;
    }

    const options = cancelled.paymentMode === InsurancePaymentMode.EXTERNAL_PAYMENT
      ? { externalRefund: { externalRefundId: requiredEnv('LUNIXI_EXTERNAL_REFUND_ID'), refundedAt: env('LUNIXI_EXTERNAL_REFUNDED_AT') || new Date() } }
      : {};
    const refunded = await insurance.refundPremium(orderId, options, `ins-refund:${orderId}`);
    print({ orderId, refundStatus: refunded.refundStatus, status: refunded.status });
  } catch (error) {
    // e.g. 409 insurance.order.state_conflict with details.reason policy_not_issued.
    if (error instanceof ApiError) {
      print({ status: error.statusCode, code: error.code, details: error.response?.details ?? null });
      return;
    }
    throw error;
  }
})();
