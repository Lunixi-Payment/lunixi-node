'use strict';

/**
 * A single-use link for a set amount — an invoice or a personal payment request.
 *
 * Amounts are integers in minor units: 150000 is 1,500.00 TRY.
 * Keep the Idempotency-Key you used: sending the same key and body again returns
 * the same link (`replayed: true`) instead of creating a second one. The same key
 * with a DIFFERENT body is 409 `payment_link.idempotency.conflict`, so every
 * field — the expiry included — is derived from the invoice, never from the
 * current time: running this again for the same invoice replays it. Set
 * LUNIXI_INVOICE_NO and LUNIXI_INVOICE_DATE (YYYY-MM-DD) together; both default
 * to today's invoice.
 *
 * The API key needs the `payment-link:create` scope. A TEST key creates a TEST
 * link; no money is taken on it.
 */

const { sampleClient, env, print } = require('../_common/bootstrap');
const { CreatePaymentLinkRequest, PaymentLinkUsage } = require('../../src');

const DAY_MS = 24 * 60 * 60 * 1000;

(async () => {
  const invoiceDate = env('LUNIXI_INVOICE_DATE', new Date().toISOString().slice(0, 10));
  const invoiceNo = env('LUNIXI_INVOICE_NO', `INV-${invoiceDate}-0001`);
  // Due 14 days after the invoice date, at 23:59:59 Istanbul time (UTC+3).
  const expiresAt = new Date(Date.parse(`${invoiceDate}T20:59:59.000Z`) + 14 * DAY_MS);

  const request = CreatePaymentLinkRequest.fixed(PaymentLinkUsage.SINGLE_USE, 150000, 'TRY', 'Danışmanlık bedeli')
    .withDescription(`Fatura ${invoiceNo}`)
    .withTaxNote('KDV dahil')
    .withExpiresAt(expiresAt)
    .withReference(invoiceNo)
    .withRecipient({
      name: env('LUNIXI_RECIPIENT_NAME', 'Ada Yilmaz'),
      email: env('LUNIXI_RECIPIENT_EMAIL', 'ada@example.com'),
    })
    .withMetadata({ invoiceNo });

  const link = await sampleClient().paymentLinks.create(request, `plink-invoice-${invoiceNo}`);
  print({ id: link.id, url: link.url, state: link.state, rowVersion: link.rowVersion, replayed: link.replayed });
})();
