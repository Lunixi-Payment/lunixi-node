'use strict';

/**
 * Payments received through a link, and every attempt on it.
 *
 * Fulfil orders from the `payment.captured` webhook (its payload carries
 * `paymentLinkId` and `paymentLinkCode`), not from these lists: they are for
 * reporting and reconciliation.
 */

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');
const { PaymentLinkAttemptState } = require('../../src');

(async () => {
  const links = sampleClient().paymentLinks;
  const linkId = requiredEnv('LUNIXI_PAYMENT_LINK_ID');

  const payments = [];
  for await (const payment of links.iteratePayments(linkId, { limit: 100 })) {
    payments.push({
      paymentId: payment.paymentId,
      amountMinor: payment.amountMinor,
      refundedAmountMinor: payment.refundedAmountMinor,
      receiptNumber: payment.receiptNumber,
    });
  }
  print(payments);

  const failed = await links.listAttempts(linkId, {
    state: [PaymentLinkAttemptState.FAILED, PaymentLinkAttemptState.EXPIRED],
    limit: 20,
  });
  print(failed.items.map((attempt) => ({ id: attempt.id, state: attempt.state, failureCode: attempt.failureCode })));
})();
