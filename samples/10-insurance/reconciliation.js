'use strict';

/**
 * Last month's reconciliation with your insurance providers: totals per
 * connection and the CSV file (one line per policy, amounts in minor units).
 * A file holds at most 20000 orders; a longer export continues with
 * `nextCursor`. The period is on the order creation time, at most 366 days.
 */

const fs = require('node:fs');
const { sampleClient, print } = require('../_common/bootstrap');

(async () => {
  const insurance = sampleClient().insurance;
  const now = new Date();
  const period = {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };

  const summary = await insurance.getReconciliationSummary(period);
  for (const group of summary.groups) {
    print({
      provider: group.provider.name,
      currency: group.currency,
      premiumCollectedBy: group.premiumCollectedBy,
      orderCount: group.totals.orderCount,
      collectedPremiumAmount: group.totals.collectedPremiumAmount,
      inForcePolicyCount: group.totals.inForcePolicyCount,
      refundOpenOrderCount: group.totals.refundOpenOrderCount,
    });
  }

  let cursor;
  for (let part = 1; ; part += 1) {
    const file = await insurance.exportReconciliation({ ...period, cursor });
    if (file.aborted) throw new Error('The export was interrupted; request it again.');
    fs.writeFileSync(`insurance-reconciliation-${part}.csv`, file.data);
    if (!file.truncated) break;
    cursor = file.nextCursor;
  }
})();
