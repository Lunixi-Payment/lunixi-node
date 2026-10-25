'use strict';

// Faturana Yansıt (charge to the mobile phone bill) from the merchant server:
//   1. payments.listPaymentMethods() gives the providers (in your form settings order)
//      and the fields they ask for; with more than one provider your buyer picks one;
//   2. payments.directMethodPayment() starts the payment; the response carries an
//      OTP action and the code is sent to the buyer's line;
//   3. payments.confirmPaymentAction() sends the code the buyer entered
//      (type "resend" instead of a code to get a new one).
// The final result is also delivered by webhook (payment.captured / payment.failed).

const readline = require('node:readline/promises');
const { DirectMethodPaymentRequest, PaymentMethod, PaymentActionType } = require('../../src');
const { sampleClient, env, idempotencyKey, sampleBuyer, sampleBasketItems, print } = require('../_common/bootstrap');

(async () => {
  const client = sampleClient();
  const amount = 5000;
  const gsmNumber = env('LUNIXI_BUYER_GSM', '+905350000000');

  const methods = (await client.payments.listPaymentMethods()).data.methods;
  const method = methods.find((entry) => entry.paymentMethod === PaymentMethod.MOBILE_BILLING);
  if (!method) throw new Error('Faturana Yansıt is not open for this account (form settings and provider connection).');
  // With more than one provider let the buyer pick (here: LUNIXI_MOBILE_BILLING_PROVIDER, else the first).
  const provider = method.providers.find((entry) => entry.providerCode === env('LUNIXI_MOBILE_BILLING_PROVIDER'))
    || method.providers[0];
  const fields = {};
  for (const field of provider.inputFields) {
    if (field.key === 'gsmNumber') fields.gsmNumber = gsmNumber;
  }

  const orderId = `ORD-MB-${Date.now()}`;
  const request = new DirectMethodPaymentRequest(amount, 'TRY', orderId)
    .withMethodFields(PaymentMethod.MOBILE_BILLING, provider.providerCode, fields)
    .withBuyer(sampleBuyer())
    .withBasketItems(sampleBasketItems(amount))
    .withCallbackUrl('https://merchant.example/payment/callback');

  let response = await client.payments.directMethodPayment(request, idempotencyKey('mobile-billing'));
  print(response);

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (response.data.action && response.data.action.type === PaymentActionType.OTP) {
      const { paymentId, action } = response.data;
      const answer = (await prompt.question(`Code sent to ${action.otp?.maskedTarget || 'the line'} (or "resend"): `)).trim();
      response = answer === 'resend'
        ? await client.payments.resendPaymentAction(paymentId, action.id)
        : await client.payments.confirmPaymentAction(paymentId, action.id, { otp: answer });
      print(response);
    }
  } finally {
    prompt.close();
  }
})();
