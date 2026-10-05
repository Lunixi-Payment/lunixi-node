'use strict';

/**
 * Sends a link by e-mail. Without `recipientEmail` the link's own `recipient`
 * is used.
 *
 * The Idempotency-Key is required: reuse the same key when you retry, so the
 * buyer does not receive the message twice.
 *
 * A send can be accepted and still fail: check `delivery.state` and
 * `delivery.failureReason`. With a TEST key only your organisation's own
 * verified member addresses receive messages
 * (`test_mode_recipient_not_allowed` otherwise).
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');
const { PaymentLinkDeliveryChannel } = require('../../src');

(async () => {
  const linkId = requiredEnv('LUNIXI_PAYMENT_LINK_ID');
  const result = await sampleClient().paymentLinks.send(
    linkId,
    {
      channel: PaymentLinkDeliveryChannel.EMAIL,
      recipientEmail: env('LUNIXI_RECIPIENT_EMAIL') || undefined,
      locale: 'tr',
    },
    `plink-send-${linkId}-${env('LUNIXI_SEND_ROUND', '1')}`,
  );
  print(result);
})();
