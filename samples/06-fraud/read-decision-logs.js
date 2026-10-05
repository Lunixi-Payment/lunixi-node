'use strict';

/**
 * Reads decision logs. Paging is cursor-based: `iterate` follows the cursors so
 * callers never have to reach past the first page by hand.
 */

const { sampleClient, print } = require('../_common/bootstrap');

(async () => {
  const client = sampleClient();

  const page = await client.fraud.decisions.list({ limit: 20 });
  print({ count: page.items.length, hasMore: page.hasMore, nextCursor: page.nextCursor });

  let seen = 0;
  for await (const decision of client.fraud.decisions.iterate({ limit: 100 })) {
    seen += 1;
    if (seen >= 250) break;
  }
  console.log(`walked ${seen} decisions`);
})();
