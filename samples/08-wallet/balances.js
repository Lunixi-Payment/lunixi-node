'use strict';

/**
 * Balances of one end user, per wallet account. `balance` is minor units as a
 * string ("12550" = 125.50 TRY); `fromCache` is true when the figure came from
 * the short-lived cache (money decisions are always re-read by the wallet).
 *
 * The API key needs `wallet:enduser:read`.
 */

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  const { balances } = await sampleClient().wallet.endUsers.getBalances(requiredEnv('LUNIXI_WALLET_END_USER_ID'));
  print(balances);
})();
