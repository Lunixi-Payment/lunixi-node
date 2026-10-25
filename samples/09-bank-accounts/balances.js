'use strict';

/**
 * The latest balance of each connected account. Amounts are integers in minor
 * units (125050 = 1,250.50 TRY); `availableMinor` and `blockedMinor` are left
 * out when the bank does not report them. Needs `bank-connect:transactions:view`.
 */

const { sampleClient, env, print } = require('../_common/bootstrap');

(async () => {
  const accountId = env('LUNIXI_BANK_ACCOUNT_ID');
  const filters = { currency: 'TRY', ...(accountId ? { accountId: [accountId] } : {}) };

  for await (const balance of sampleClient().bankConnect.iterateBalances(filters)) {
    print({
      accountId: balance.accountId,
      balanceMinor: balance.balanceMinor,
      availableMinor: balance.availableMinor ?? null,
      asOf: balance.asOf ?? null,
    });
  }
})();
