'use strict';

/**
 * Every operation of one end user, newest first, following the cursor.
 * `GET /wallet/operations/:id` (`operations.get`) adds the status history.
 *
 * The API key needs `wallet:operation:read`.
 */

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  const wallet = sampleClient().wallet;
  const rows = [];
  for await (const op of wallet.operations.iterate({ endUserId: requiredEnv('LUNIXI_WALLET_END_USER_ID'), limit: 50 })) {
    rows.push({ id: op.id, type: op.operationType, status: op.status, amount: op.amount, currency: op.asset, createdAt: op.createdAt });
  }
  print(rows);
})();
