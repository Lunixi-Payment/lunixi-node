'use strict';

/**
 * Asks a wallet holder to pay your shop (Wallet2Buy), then approves it.
 *
 * The creditor is the wallet terminal bound to your signing key; without one the
 * gateway answers 403 `WALLET_TERMINAL_NOT_BOUND`. The approve call names the
 * buyer (`buyerEndUserId`) and repeats the integrityHash/nonce from the request
 * answer, plus the OTP when `otpRequired`.
 *
 * The API key needs `wallet:operation:intervene`.
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');

(async () => {
  const wallet = sampleClient().wallet;
  const orderRef = env('LUNIXI_WALLET_ORDER_REF', 'ord-0001');

  const request = await wallet.payments.request({
    buyerWalletNo: requiredEnv('LUNIXI_WALLET_BUYER_NO'),
    amount: env('LUNIXI_WALLET_AMOUNT', '4990'),
    currency: 'TRY',
    paymentPurpose: 'ORDER',
    orderRef,
  }, `wallet-pay-${orderRef}`);
  print({ request });

  const otpCode = env('LUNIXI_WALLET_OTP_CODE');
  if (request.otpRequired && !otpCode) return;

  const approved = await wallet.payments.approve(request.requestId, {
    buyerEndUserId: requiredEnv('LUNIXI_WALLET_BUYER_END_USER_ID'),
    integrityHash: request.integrityHash,
    nonce: request.nonce,
    ...(otpCode ? { otpCode } : {}),
  }, `wallet-pay-approve-${orderRef}`);
  print({ approved });
})();
