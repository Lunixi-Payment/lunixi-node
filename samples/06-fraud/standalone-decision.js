'use strict';

/**
 * EX-2 — "is this payment fraud?"
 *
 * A merchant or PSP running its own gateway asks for a decision and applies it
 * in its own authorization. `channel: standalone_api` is the server-to-server
 * lane; declaring a platform channel such as `lunixi_checkout` is a 400.
 */

const { sampleClient, print } = require('../_common/bootstrap');
const { fraud, FraudDecisionValue } = require('../../src');

(async () => {
  const client = sampleClient();

  const decision = await client.fraud.evaluate({
    channel: fraud.CHANNELS.STANDALONE_API,
    surface: fraud.SURFACES.TRANSACTION,
    stage: fraud.STAGES.PRE_AUTHORIZATION,
    operationKind: fraud.OPERATION_KINDS.CARD_SALE,
    authModeRequested: fraud.AUTH_MODES.TWO_D,
    productContext: fraud.PRODUCT_CONTEXTS.DIRECT_API,
    transactionRef: 'order-2026-0001',
    subjectType: 'card_payment',
    subjectId: 'order-2026-0001',
    payment: { amount: 25000, currency: 'TRY', is3D: false },
    customer: { email: 'ada@example.com', isNew: true },
  });

  print(decision);

  switch (decision.decision) {
    case FraudDecisionValue.ALLOW:
      console.log('→ authorize');
      break;
    case FraudDecisionValue.FORCE_3D:
      console.log('→ step up to 3-D Secure, then re-evaluate at stage post_authentication');
      break;
    case FraudDecisionValue.REVIEW:
      console.log('→ hold for manual review');
      break;
    case FraudDecisionValue.BLOCK:
      console.log('→ decline');
      break;
    default:
      console.log('→ unconfigured merchant: the policy default applies');
  }
})();
