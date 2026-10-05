'use strict';

/**
 * EX-5 (ingest half) — transfer event feed.
 *
 * Event ingest is authenticated by the per-request Ed25519 signature, so the
 * body cannot claim a different merchant. Velocity and counting rules only fire
 * once you feed these events.
 *
 * On 429/503 the gateway sends Retry-After; honour it rather than retrying hot.
 */

const { sampleClient, print, idempotencyKey } = require('../_common/bootstrap');
const { RateLimitError, ServiceUnavailableError } = require('../../src');

(async () => {
  const client = sampleClient();

  // `merchantId` is stamped from the authenticated key and is never read from the
  // body, so it is not sent here.
  const now = new Date().toISOString();
  const events = [
    {
      eventId: 'evt-2026-0001',
      subjectType: 'bank_transfer',
      eventType: 'transfer_completed',
      occurredAt: now,
      amountMinor: 1500000,
      currency: 'TRY',
      customerId: 'cus_1',
    },
    {
      eventId: 'evt-2026-0002',
      subjectType: 'bank_transfer',
      eventType: 'transfer_completed',
      occurredAt: now,
      amountMinor: 2200000,
      currency: 'TRY',
      customerId: 'cus_1',
    },
  ];

  try {
    print(await client.fraud.events.recordBatch(events, idempotencyKey('fraud-events')));
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof ServiceUnavailableError) {
      console.log(`Retry after ${error.retryAfter ?? 'unspecified'} seconds.`);
      if (error.quota) print(error.quota);
      return;
    }
    throw error;
  }
})();
