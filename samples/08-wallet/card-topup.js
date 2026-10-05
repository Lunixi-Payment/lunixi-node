'use strict';

/**
 * Starts a card top-up. Show `checkoutFormContent` to the end user (or follow
 * `redirectUrl` / `threeDsHtml`). The wallet is credited when the card payment
 * completes; listen for the `wallet.topup.completed` webhook rather than
 * polling.
 *
 * The API key needs `wallet:operation:intervene`.
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');

(async () => {
  const topupId = env('LUNIXI_WALLET_TOPUP_ID', 'topup-0001');
  const started = await sampleClient().wallet.topups.startCard({
    creditWalletAccountId: requiredEnv('LUNIXI_WALLET_ACCOUNT_ID'),
    amount: env('LUNIXI_WALLET_AMOUNT', '25000'),
    currency: 'TRY',
    returnUrl: env('LUNIXI_WALLET_RETURN_URL', 'https://merchant.example/wallet/return'),
  }, `wallet-topup-${topupId}`);
  print({ operationId: started.operationId, paymentId: started.paymentId, status: started.status, redirectUrl: started.redirectUrl });
})();
