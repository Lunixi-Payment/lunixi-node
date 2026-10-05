'use strict';

/**
 * Wallet-to-wallet transfer in three calls:
 *
 *   1. quote     — fee, tax and total charge; whether the balance is enough
 *   2. initiate  — reserves the limit, returns operationId + integrityHash +
 *                  nonce and whether an OTP was sent to the end user
 *   3. complete  — commits with the same integrityHash/nonce (+ the OTP)
 *
 * `endUserId` is the end user the money belongs to; the source account must be
 * theirs (otherwise 404 `WALLET_NOT_FOUND`). Each money call has its own
 * Idempotency-Key — derive it from your own transfer id so a retry repeats the
 * same operation rather than sending twice.
 *
 * Set LUNIXI_WALLET_OTP_CODE when the initiate answer says `otpRequired: true`
 * (run initiate, read the SMS, then run again with the code: the same key
 * replays initiate and goes on to complete).
 *
 * The API key needs `wallet:operation:intervene`.
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');

(async () => {
  const wallet = sampleClient().wallet;
  const transferId = env('LUNIXI_WALLET_TRANSFER_ID', 'tr-0001');
  const transfer = {
    endUserId: requiredEnv('LUNIXI_WALLET_END_USER_ID'),
    sourceWalletAccountId: requiredEnv('LUNIXI_WALLET_ACCOUNT_ID'),
    destinationWalletNo: requiredEnv('LUNIXI_WALLET_DESTINATION_NO'),
    amount: env('LUNIXI_WALLET_AMOUNT', '12550'),
    currency: 'TRY',
  };

  const quote = await wallet.transfers.quoteW2W(transfer);
  print({ quote });
  if (!quote.sufficientBalance) return;

  const started = await wallet.transfers.initiateW2W(
    { ...transfer, scheduleVersionId: quote.scheduleVersionId, otpChannel: 'SMS' },
    `w2w-init-${transferId}`,
  );
  print({ started });

  const otpCode = env('LUNIXI_WALLET_OTP_CODE');
  if (started.otpRequired && !otpCode) return;

  const done = await wallet.transfers.completeW2W(started.operationId, {
    endUserId: transfer.endUserId,
    integrityHash: started.integrityHash,
    nonce: started.nonce,
    ...(otpCode ? { otpCode } : {}),
  }, `w2w-complete-${transferId}`);
  print({ done });
})();
