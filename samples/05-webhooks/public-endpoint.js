'use strict';

const express = require('express');
const { WebhookVerifier } = require('../../src');
const { requiredEnv } = require('../_common/bootstrap');

const app = express();

app.post('/webhooks/lunixi', express.raw({ type: '*/*' }), (req, res) => {
  let event;
  try {
    event = new WebhookVerifier(requiredEnv('LUNIXI_WEBHOOK_SECRET')).verify(req.body, req.headers);
  } catch {
    res.status(400).send('invalid signature');
    return;
  }

  if (alreadyProcessed(event.id)) {
    res.status(200).send('duplicate');
    return;
  }

  switch (event.type) {
    case 'payment.captured':
    case 'payment.succeeded':
    case 'payment.completed':
      break;
    case 'payment.failed':
      break;
    case 'payment.refunded':
    case 'payment.partially_refunded':
      break;
  }

  markProcessed(event.id);
  res.status(200).send('ok');
});

function alreadyProcessed(eventId) {
  void eventId;
  return false;
}

function markProcessed(eventId) {
  void eventId;
}

module.exports = app;
