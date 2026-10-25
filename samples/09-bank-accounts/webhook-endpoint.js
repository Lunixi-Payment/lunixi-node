'use strict';

/**
 * Webhook endpoint for `bank_account.transaction.received` (subscribe a
 * BANK_CONNECT endpoint to `bank_account.*`). The event is verified first and
 * deduplicated by its id: delivery is at-least-once and the id is the same on
 * every redelivery of the same transaction.
 */

const express = require('express');
const { WebhookVerifier, BankConnectEvents } = require('../../src');
const { requiredEnv } = require('../_common/bootstrap');

const app = express();

app.post('/webhooks/lunixi/bank-accounts', express.raw({ type: '*/*' }), (req, res) => {
  let event;
  try {
    event = new WebhookVerifier(requiredEnv('LUNIXI_WEBHOOK_SECRET')).verify(req.body, req.headers);
  } catch {
    res.status(400).send('invalid signature');
    return;
  }

  if (event.type === BankConnectEvents.TRANSACTION_RECEIVED) {
    const transaction = event.data;
    // Store it keyed by event.id (or transaction.transactionId), then match
    // transaction.description against your open orders. Keep TEST events
    // (event.raw.environment === 'TEST') away from live books.
    console.log('bank', transaction.accountId, transaction.direction, transaction.amountMinor, transaction.currency);
  }

  res.status(200).send('ok');
});

module.exports = app;
