'use strict';

/**
 * A multi-use itemized link: the buyer picks quantities of each ticket type.
 *
 * `itemKey` is the permanent identity of a line (stock is counted on it) and
 * cannot be changed later. `capacity` caps the units sold across all payments;
 * when it is reached the link stays ACTIVE with `availability.soldOut = true`.
 */

const { sampleClient, idempotencyKey, print } = require('../_common/bootstrap');
const {
  CreatePaymentLinkRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  PaymentLinkUsage,
  PaymentLinkButtonLabel,
  CustomFieldType,
} = require('../../src');

const DAY_MS = 24 * 60 * 60 * 1000;

(async () => {
  // The concert is 30 days from today at 20:00 Istanbul time (17:00 UTC); sales
  // close two hours before it. `expiresAt` must be in the future.
  const eventAt = new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T17:00:00.000Z`) + 30 * DAY_MS);
  const salesCloseAt = new Date(eventAt.getTime() - 2 * 60 * 60 * 1000);

  const request = CreatePaymentLinkRequest.itemized(PaymentLinkUsage.MULTI_USE, 'TRY', 'Yıl sonu konseri', [
    new PaymentLinkItem('Standart bilet', 45000).withItemKey('standard').withQuantityRange(0, 6).withCapacity(400),
    new PaymentLinkItem('Balkon bilet', 30000).withItemKey('balcony').withQuantityRange(0, 6).withCapacity(150),
  ])
    .withEventAt(eventAt)
    .withExpiresAt(salesCloseAt)
    .withButtonLabelKey(PaymentLinkButtonLabel.BUY)
    .withTermsAcceptanceRequired()
    .addCustomField(new PaymentLinkCustomField('seat_note', 'Koltuk tercihi', CustomFieldType.TEXT).withMaxLength(60))
    .withTags(['konser', 'etkinlik']);

  const link = await sampleClient().paymentLinks.create(request, idempotencyKey('plink-tickets'));
  print({ id: link.id, url: link.url, items: link.items, availability: link.availability });
})();
