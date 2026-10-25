'use strict';

/**
 * Asks for a fresh read of one account. It never reads earlier than the bank's
 * minimum interval: the answer is QUEUED (reading now) or SCHEDULED (at
 * `scheduledAt`). New transactions then arrive by the
 * `bank_account.transaction.received` webhook. Needs `bank-connect:view`.
 */

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');
const { RateLimitError, ApiError } = require('../../src');

(async () => {
  try {
    const sync = await sampleClient().bankConnect.requestSync(requiredEnv('LUNIXI_BANK_ACCOUNT_ID'));
    print({ syncStatus: sync.syncStatus, scheduledAt: sync.scheduledAt ?? null, lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt ?? null });
  } catch (error) {
    if (error instanceof RateLimitError) {
      print({ rateLimited: true, retryAfterSeconds: error.retryAfter });
      return;
    }
    // e.g. 409 bank_connect.connection.not_active: the connection is not ACTIVE or DEGRADED.
    if (error instanceof ApiError) {
      print({ status: error.statusCode, code: error.code });
      return;
    }
    throw error;
  }
})();
