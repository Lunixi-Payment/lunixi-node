'use strict';

/**
 * Ticket cancellation insurance sold with your own Lunixi payment:
 * eligibility -> quote -> order -> premium item in the payment basket -> bind.
 *
 * 1. `searchProducts` with the basket items the payment will carry: an empty
 *    list means insurance is not offered — continue the checkout without it.
 * 2. `createQuote` with the same items and the type's fields. Policy-stage
 *    fields (PNR, ticket number, the insured's e-mail and phone) are sent here
 *    too; there is no later call to add them.
 * 3. Show the option (title, premium, terms) to the buyer; on acceptance
 *    `createOrder` records the consent.
 * 4. Create the payment with the insured items plus the premium item
 *    (`id` = orderId, VIRTUAL, price = premium); `amount` is the sum.
 * 5. `bindPayment`. Once the payment is captured the policy is requested on
 *    its own; the result arrives by the `insurance.policy.issued` or
 *    `insurance.policy.failed` webhook.
 *
 * The insured's details come from your checkout form; here they are read from
 * the environment (see samples/.env.example). Needs the INSURANCE_SERVICE
 * product on the key and an active insurance connection in the dashboard.
 */

const {
  BasketItem,
  CreateIntentRequest,
  InsuranceClient,
  InsuranceItemCategory,
  InsurancePremiumCollectedBy,
  InsuranceQuoteStatus,
  ApiError,
} = require('../../src');
const { sampleClient, env, requiredEnv, sampleBuyer, sampleBillingAddress, print } = require('../_common/bootstrap');

const INSURANCE_TYPE = 'TICKET_CANCELLATION';
const TICKET_PRICE = 100000;

(async () => {
  const lunixi = sampleClient();
  const orderRef = `ORD-INS-${Date.now()}`;
  const ticketId = `${orderRef}-T1`;
  const departureAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const ticket = new BasketItem({
    id: ticketId,
    price: TICKET_PRICE,
    name: 'Izmir-Ankara train ticket',
    category1: 'ticket',
    itemType: BasketItem.TYPE_VIRTUAL,
    insuranceCategory: InsuranceItemCategory.TICKET,
    insuranceTypes: [INSURANCE_TYPE],
    insuranceContext: { transportMode: 'TRAIN', departureAt },
  });

  const { products } = await lunixi.insurance.searchProducts({
    currency: 'TRY',
    insuranceType: INSURANCE_TYPE,
    context: { items: [ticket] },
  });
  if (products.length === 0) {
    print({ insuranceOffered: false });
    return;
  }

  const quote = await lunixi.insurance.createQuote({
    insuranceType: INSURANCE_TYPE,
    currency: 'TRY',
    merchantOrderId: orderRef,
    context: { items: [ticket] },
    insured: [{
      identityType: requiredEnv('LUNIXI_INSURED_IDENTITY_TYPE'),
      identityNumber: requiredEnv('LUNIXI_INSURED_IDENTITY_NUMBER'),
      birthDate: requiredEnv('LUNIXI_INSURED_BIRTH_DATE'),
      email: requiredEnv('LUNIXI_INSURED_EMAIL'),
      phone: requiredEnv('LUNIXI_INSURED_PHONE'),
    }],
    tickets: [{
      basketItemId: ticketId,
      transportMode: 'TRAIN',
      carrier: env('LUNIXI_TICKET_CARRIER', 'Example Rail'),
      priceAmount: TICKET_PRICE,
      departureAt,
      originCity: 'Izmir',
      destinationCity: 'Ankara',
      pnr: requiredEnv('LUNIXI_TICKET_PNR'),
      ticketNumber: requiredEnv('LUNIXI_TICKET_NUMBER'),
    }],
  });

  // This flow collects the premium in your payment: pick a MERCHANT option.
  const option = quote.options.find((candidate) => candidate.status === InsuranceQuoteStatus.QUOTED
    && candidate.premiumCollectedBy === InsurancePremiumCollectedBy.MERCHANT);
  if (!option) {
    print({ insuranceOffered: false, options: quote.options.map(({ status, premiumCollectedBy }) => ({ status, premiumCollectedBy })) });
    return;
  }

  // Show option.title, option.premiumAmount and the terms to the buyer first.
  let order;
  try {
    order = await lunixi.insurance.createOrder({
      quoteId: option.quoteId,
      consent: InsuranceClient.consentFromQuote(option, new Date()),
    }, `ins-order:${orderRef}`);
  } catch (error) {
    // 409 insurance.quote.expired: the price is time-limited; quote again.
    if (error instanceof ApiError) {
      print({ status: error.statusCode, code: error.code });
      return;
    }
    throw error;
  }

  const premiumItem = InsuranceClient.premiumBasketItem(order, { name: 'Ticket cancellation insurance', category1: 'insurance' });
  const request = new CreateIntentRequest(TICKET_PRICE + order.premiumAmount, 'TRY', orderRef)
    .withCallbackUrl('https://merchant.example/payment/callback')
    .withBuyer(sampleBuyer())
    .withBillingAddress(sampleBillingAddress())
    .withBasketItems([ticket, premiumItem]);
  const created = await lunixi.payments.createIntent(request, `checkout:${orderRef}`);
  const intent = created.data ?? created;

  const bound = await lunixi.insurance.bindPayment(order.orderId, intent.paymentId, `ins-bind:${orderRef}`);
  print({
    orderId: bound.orderId,
    paymentIntentId: bound.paymentIntentId,
    premiumAmount: bound.premiumAmount,
    status: bound.status,
    paymentMode: bound.paymentMode,
  });
})();
