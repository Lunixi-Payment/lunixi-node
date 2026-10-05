'use strict';

/**
 * Changes a link and pauses it.
 *
 * Every change creates a new version of the link. Send the link's current
 * `rowVersion` as `expectedRowVersion`: if someone changed the link in between,
 * the gateway answers 409 `payment_link.link.version_conflict` instead of
 * overwriting their change — read the link again and retry.
 *
 * Amount fields are locked (409 `payment_link.link.amount_locked`) while a
 * payment is in progress or once the link has been paid. `usage`, `amountMode`
 * and `currency` can never change.
 */

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  const links = sampleClient().paymentLinks;
  const linkId = requiredEnv('LUNIXI_PAYMENT_LINK_ID');

  const current = await links.get(linkId);
  const updated = await links.update(linkId, current.rowVersion, {
    title: `${current.title} (güncellendi)`,
    successRedirectUrl: null,
  });

  const paused = await links.pause(linkId, { expectedRowVersion: updated.rowVersion, reason: 'Stok sayımı' });
  print({ version: paused.version, rowVersion: paused.rowVersion, state: paused.state });
})();
