'use strict';

/**
 * Your bank connections and the accounts read from them, with how current each
 * account's data is. Connecting a bank happens in the Lunixi dashboard; the API
 * reads. Needs `bank-connect:view`. A TEST key sees only test-environment
 * accounts.
 */

const { sampleClient, print } = require('../_common/bootstrap');
const { BankAccountStatus } = require('../../src');

(async () => {
  const bankConnect = sampleClient().bankConnect;

  for await (const connection of bankConnect.iterateConnections()) {
    print({
      connectionId: connection.connectionId,
      bank: connection.bank.name,
      status: connection.status,
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      accountCount: connection.accountCount,
    });
  }

  for await (const account of bankConnect.iterateAccounts({ status: BankAccountStatus.ACTIVE })) {
    print({
      accountId: account.accountId,
      iban: account.ibanMasked,
      currency: account.currency,
      lastSuccessfulSyncAt: account.freshness.lastSuccessfulSyncAt,
      nextSyncAvailableAt: account.freshness.nextSyncAvailableAt,
    });
  }
})();
