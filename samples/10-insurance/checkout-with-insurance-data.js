'use strict';

/**
 * Insurance data on a basket item: send what the quote needs with the payment,
 * so the buyer is not asked for it again.
 *
 * 1. `createIntent` (Checkout Form) with the ticket and its `insuranceData`:
 *    the root fields of the type's quote body (`insured`, `tickets` …). The
 *    list type object `tickets` is ONE object for this item, without
 *    `basketItemId`. Partial data is allowed; the form asks the buyer only for
 *    what is missing, and prices the insurance on its own when nothing is.
 *    The buyer still ticks the box and the insurer's consent.
 * 2. `listProducts` with the payment: `prefill` (from `insuranceContext`),
 *    `providedFields` (from `insuranceData`, masked), `quoteReady` and
 *    `insuranceDataIssues` (data that could not be used; the payment goes on).
 * 3. Optional, Merchant API: `createQuote` with `paymentIntentId` and no type
 *    fields: the recorded data is used, e.g. to show the price on your own
 *    page before the buyer opens the form.
 *
 * The data never reaches the payment provider; Lunixi stores it encrypted for
 * the insurance quote only and erases it after the payment intent expires.
 * The insured's details come from your checkout; here they are read from the
 * environment (see samples/.env.example). Needs the INSURANCE_SERVICE product
 * and an active insurance connection.
 */

const { BasketItem, CreateIntentRequest, InsuranceItemCategory, InsuranceQuoteStatus } = require('../../src');
const { sampleClient, env, requiredEnv, sampleBuyer, sampleBillingAddress, idempotencyKey, print } = require('../_common/bootstrap');

const INSURANCE_TYPE = 'TICKET_CANCELLATION';
const TICKET_PRICE = 100000;

(async () => {
  const lunixi = sampleClient();
  const orderRef = `ORD-INSDATA-${Date.now()}`;
  const departureAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const ticket = new BasketItem({
    id: `${orderRef}-T1`,
    price: TICKET_PRICE,
    name: 'Izmir-Ankara train ticket',
    category1: 'ticket',
    itemType: BasketItem.TYPE_VIRTUAL,
    insuranceCategory: InsuranceItemCategory.TICKET,
    insuranceTypes: [INSURANCE_TYPE],
    // No personal data here: travel facts only.
    insuranceContext: { transportMode: 'TRAIN', departureAt, originCity: 'Izmir', destinationCity: 'Ankara' },
    // Personal data the quote needs; leave out what you do not have.
    insuranceData: {
      insured: [{
        identityType: requiredEnv('LUNIXI_INSURED_IDENTITY_TYPE'),
        identityNumber: requiredEnv('LUNIXI_INSURED_IDENTITY_NUMBER'),
        birthDate: requiredEnv('LUNIXI_INSURED_BIRTH_DATE'),
        email: requiredEnv('LUNIXI_INSURED_EMAIL'),
        phone: requiredEnv('LUNIXI_INSURED_PHONE'),
      }],
      tickets: {
        carrier: env('LUNIXI_TICKET_CARRIER', 'Example Rail'),
        priceAmount: TICKET_PRICE,
        pnr: requiredEnv('LUNIXI_TICKET_PNR'),
        ticketNumber: requiredEnv('LUNIXI_TICKET_NUMBER'),
      },
    },
  });

  const request = new CreateIntentRequest(TICKET_PRICE, 'TRY', orderRef)
    .withCallbackUrl('https://merchant.example/payment/callback')
    .withBuyer(sampleBuyer())
    .withBillingAddress(sampleBillingAddress())
    .withBasketItems([ticket]);
  const created = await lunixi.payments.createIntent(request, idempotencyKey('checkout-insdata'));
  const intent = created.data ?? created;

  const { products } = await lunixi.insurance.listProducts({
    currency: 'TRY',
    paymentIntentId: intent.paymentId,
    insuranceType: INSURANCE_TYPE,
  });
  const product = products[0];
  if (!product) {
    // Insurance is not offered; the payment goes on without it.
    print({ paymentId: intent.paymentId, insuranceOffered: false });
    return;
  }
  print({
    paymentId: intent.paymentId,
    prefill: product.prefill,
    providedFields: product.providedFields.map(({ path }) => path),
    quoteReady: product.quoteReady,
    insuranceDataIssues: product.insuranceDataIssues,
  });
  if (!product.quoteReady) return;

  // Merchant API: nothing but the type, the currency and the payment.
  const quote = await lunixi.insurance.createQuote({
    insuranceType: INSURANCE_TYPE,
    currency: 'TRY',
    paymentIntentId: intent.paymentId,
  });
  print({
    options: quote.options
      .filter((option) => option.status === InsuranceQuoteStatus.QUOTED)
      .map(({ quoteId, premiumAmount, premiumCollectedBy, expiresAt }) => ({ quoteId, premiumAmount, premiumCollectedBy, expiresAt })),
    excludedOptions: quote.excludedOptions.map(({ errorCode, errors }) => ({ errorCode, errors })),
  });
})();
