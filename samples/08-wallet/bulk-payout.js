'use strict';

/**
 * Creates and submits a bulk payout (e.g. a salary run). Approval must come from
 * a DIFFERENT API key (four-eyes): run `approve` with the checker's key, then
 * `process`.
 *
 * Maker key: `wallet:bulk:create` (create) and `wallet:bulk:approve` (submit).
 * Checker key: `wallet:bulk:approve`.
 */

const { sampleClient, requiredEnv, env, print } = require('../_common/bootstrap');
const { WalletBulkTargetType } = require('../../src');

(async () => {
  const wallet = sampleClient().wallet;
  const runId = env('LUNIXI_WALLET_BULK_RUN_ID', 'payroll-2026-10');

  const batch = await wallet.bulkPayouts.create({
    programId: requiredEnv('LUNIXI_WALLET_PROGRAM_ID'),
    sourceWalletAccountId: requiredEnv('LUNIXI_WALLET_ACCOUNT_ID'),
    currency: 'TRY',
    reason: runId,
    items: [
      { targetType: WalletBulkTargetType.WALLET, targetRef: requiredEnv('LUNIXI_WALLET_DESTINATION_NO'), amount: '1500000' },
      { targetType: WalletBulkTargetType.IBAN, targetRef: 'TR330006100519786457841326', beneficiaryName: 'Mehmet Kaya', amount: '2250000' },
    ],
  }, `wallet-bulk-${runId}`);

  const submitted = await wallet.bulkPayouts.submit(batch.id);
  print({ id: batch.id, status: submitted.status ?? batch.status });
})();
