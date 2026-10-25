'use strict';

// Split payment: one order paid with a stored card and Faturana Yansıt.
//   1. payments.listPaymentMethods() gives the Faturana Yansıt providers that can be
//      a split payment leg (splitEligible);
//   2. payments.createSplitPayment() starts it; the platform holds the card first and
//      charges Faturana Yansıt last, so the answer waits for its OTP;
//   3. payments.confirmPaymentAction() sends the code, then the SAME request with the
//      SAME Idempotency-Key continues the payment until it is COMPLETED.
// Deliver the order on the main payment's webhook (payment.captured, settlementMode SPLIT).

const readline = require('node:readline/promises');
const { SplitPaymentRequest, SplitPendingStep, PaymentMethod } = require('../../src');
const { sampleClient, env, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  const client = sampleClient();

  const [method] = (await client.payments.listPaymentMethods({ paymentMethod: PaymentMethod.MOBILE_BILLING })).data.methods;
  const provider = method && method.providers.find((entry) => entry.splitEligible);
  if (!provider) throw new Error('No Faturana Yansıt provider can be used in a split payment (form settings: split payments with other methods).');

  const orderId = `ORD-SPLIT-${Date.now()}`;
  const request = new SplitPaymentRequest(10000, 'TRY', requiredEnv('LUNIXI_CARD_USER_KEY'))
    .withOrderId(orderId)
    .addCardLeg(requiredEnv('LUNIXI_STORED_CARD_TOKEN'), 6000)
    .addMethodLeg(PaymentMethod.MOBILE_BILLING, provider.providerCode, 4000, { gsmNumber: env('LUNIXI_BUYER_GSM', '+905350000000') });
  const key = `split:${orderId}`;

  let response = await client.payments.createSplitPayment(request, key);
  print(response);

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (response.data.pendingStep && response.data.pendingStep.step === SplitPendingStep.ACTION) {
      const { paymentId, actionId, paymentMethod } = response.data.pendingStep;
      const code = (await prompt.question(`Code sent for the ${paymentMethod} leg: `)).trim();
      print(await client.payments.confirmPaymentAction(paymentId, actionId, { otp: code }));
      response = await client.payments.createSplitPayment(request, key);
      print(response);
    }
  } finally {
    prompt.close();
  }

  for (const step of response.data.steps) {
    console.log(`${step.sequence}. ${step.paymentMethod} ${step.splitBehavior} ${step.amount} ${step.status}`);
  }
})();
