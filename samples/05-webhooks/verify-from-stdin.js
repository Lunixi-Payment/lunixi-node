'use strict';

const { WebhookVerifier } = require('../../src');
const { requiredEnv, print } = require('../_common/bootstrap');

let rawBody = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { rawBody += chunk; });
process.stdin.on('end', () => {
  if (!rawBody.trim()) throw new Error('Provide the raw webhook JSON body on STDIN.');

  const event = new WebhookVerifier(requiredEnv('LUNIXI_WEBHOOK_SECRET')).verify(rawBody, {
    'x-lunixi-event-id': requiredEnv('LUNIXI_HEADER_EVENT_ID'),
    'x-lunixi-event-type': requiredEnv('LUNIXI_HEADER_EVENT_TYPE'),
    'x-lunixi-signature-timestamp': requiredEnv('LUNIXI_HEADER_TIMESTAMP'),
    'x-lunixi-signature': requiredEnv('LUNIXI_HEADER_SIGNATURE'),
  });

  print({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    data: event.data,
  });
});
