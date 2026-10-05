'use strict';

/**
 * Lists links newest first, with filters. `state`, `usage` and `amountMode`
 * accept several values. Paging is cursor-based: pass `nextCursor` back as
 * `cursor`, or let `iterate()` follow the cursors for you.
 */

const { sampleClient, env, print } = require('../_common/bootstrap');
const { PaymentLinkState } = require('../../src');

(async () => {
  const links = sampleClient().paymentLinks;

  const page = await links.list({
    limit: 20,
    state: [PaymentLinkState.ACTIVE, PaymentLinkState.PAUSED],
    query: env('LUNIXI_PAYMENT_LINK_QUERY') || undefined,
  });
  print({ count: page.items.length, hasMore: page.hasMore, nextCursor: page.nextCursor });

  let collectedMinor = 0;
  for await (const link of links.iterate({ state: PaymentLinkState.COMPLETED, limit: 100 })) {
    collectedMinor += link.collectedAmountMinor;
  }
  print({ completedLinksCollectedMinor: collectedMinor });
})();
