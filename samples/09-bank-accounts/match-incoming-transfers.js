'use strict';

/**
 * Incoming transfers of the last 7 days, matched to your orders by the payment
 * reference the payer wrote into the transfer description. The list is ordered
 * by when Lunixi recorded each transaction (newest first), so a transfer the
 * bank reports late is never skipped while paging. A window may be at most 92
 * days. Needs `bank-connect:transactions:view`.
 */

const { sampleClient, print } = require('../_common/bootstrap');
const { BankTransactionDirection, BankTransactionType } = require('../../src');

const REFERENCE = /\bLNX-[A-Z0-9]{4,12}\b/;

(async () => {
  const transactions = sampleClient().bankConnect.iterateTransactions({
    bookedFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    direction: BankTransactionDirection.CREDIT,
    canonicalType: [BankTransactionType.TRANSFER_IN],
    limit: 100,
  });

  for await (const transaction of transactions) {
    const match = REFERENCE.exec(transaction.description || '');
    print({
      transactionId: transaction.transactionId,
      amountMinor: transaction.amountMinor,
      bookedAt: transaction.bookedAt,
      from: transaction.counterpartyNameMasked ?? null,
      orderReference: match ? match[0] : null,
    });
  }
})();
