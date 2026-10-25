'use strict';

/**
 * Webhook endpoint for insurance events (subscribe an INSURANCE_SERVICE
 * endpoint to `insurance.*`). The event is verified first and deduplicated by
 * its id: delivery is at-least-once and the id is the same on every
 * redelivery. Decide on the order from the webhook; API responses only show
 * the current state.
 */

const express = require('express');
const { WebhookVerifier, InsuranceEvents } = require('../../src');
const { requiredEnv } = require('../_common/bootstrap');

const app = express();

app.post('/webhooks/lunixi/insurance', express.raw({ type: '*/*' }), (req, res) => {
  let event;
  try {
    event = new WebhookVerifier(requiredEnv('LUNIXI_WEBHOOK_SECRET')).verify(req.body, req.headers);
  } catch {
    res.status(400).send('invalid signature');
    return;
  }

  const order = event.data;
  switch (event.type) {
    case InsuranceEvents.POLICY_ISSUED:
      // Store order.policies (policyId, policyNumber) against order.merchantOrderId.
      console.log('insurance issued', order.insuranceOrderId, order.policies.length);
      break;
    case InsuranceEvents.POLICY_FAILED:
    case InsuranceEvents.REFUND_REQUIRED:
      console.log('insurance needs attention', order.insuranceOrderId, order.errorCode);
      break;
    case InsuranceEvents.POLICY_DOCUMENT_READY:
      // policies[].documentUrl is downloaded with a signed call: insurance.getPolicyDocument(policyId).
      console.log('insurance document ready', order.insuranceOrderId);
      break;
    case InsuranceEvents.POLICY_CANCELLED:
    case InsuranceEvents.REFUND_COMPLETED:
      console.log('insurance', event.type, order.insuranceOrderId, order.status);
      break;
    case InsuranceEvents.LEAD_SUBMITTED:
      // A lead summary, not an order: data.lead (leadId, insuranceType, status).
      console.log('insurance lead submitted', event.data.lead.leadId, event.data.lead.insuranceType);
      break;
    default:
      break;
  }

  res.status(200).send('ok');
});

module.exports = app;
