'use strict';

/**
 * Negative example: a platform channel cannot be declared from outside.
 *
 * `lunixi_checkout` and `wallet` come only from Lunixi's own services. Declaring
 * one here would be a way to trigger flows bound to a platform channel, so the
 * gateway answers 400 — the SDK surfaces it as ValidationError.
 */

const { sampleClient, print } = require('../_common/bootstrap');
const { ValidationError } = require('../../src');

(async () => {
  const client = sampleClient();

  try {
    await client.fraud.evaluate({
      channel: 'lunixi_checkout',
      transactionRef: 'order-2026-0002',
    });
    console.error('Expected a 400 and did not get one.');
    process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    print({ statusCode: error.statusCode, code: error.code, message: error.message });
  }
})();
