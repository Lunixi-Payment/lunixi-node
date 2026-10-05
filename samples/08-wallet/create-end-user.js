'use strict';

/**
 * Creates an end user (and their default wallet) for one of your customers.
 *
 * `externalCustomerId` is your own customer id: keep it stable and use it in the
 * Idempotency-Key, so running this again for the same customer replays the
 * first answer instead of creating a second end user (409
 * `WALLET_ENDUSER_EXISTS` if the key differs but the customer exists).
 *
 * The API key needs `wallet:enduser:manage` and the WALLET_SERVICE product.
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');
const { WalletAccountType } = require('../../src');

(async () => {
  const programId = requiredEnv('LUNIXI_WALLET_PROGRAM_ID');
  const externalCustomerId = env('LUNIXI_WALLET_CUSTOMER_ID', 'cust-0001');

  const result = await sampleClient().wallet.endUsers.create({
    programId,
    accountType: WalletAccountType.PERSONAL,
    phone: env('LUNIXI_WALLET_PHONE', '+905301234567'),
    externalCustomerId,
    displayName: env('LUNIXI_WALLET_DISPLAY_NAME', 'Ada Yilmaz'),
    defaultCurrency: 'TRY',
  }, `wallet-enduser-${externalCustomerId}`);

  print({
    endUserId: result.endUser.id,
    status: result.endUser.status,
    walletId: result.defaultWallet.id,
    walletNo: result.defaultWallet.walletNo,
    accounts: result.defaultWallet.accounts,
  });
})();
