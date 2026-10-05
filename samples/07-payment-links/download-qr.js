'use strict';

/**
 * Saves the link's QR code. The QR encodes the link URL
 * (`https://pay.lunixi.com/<code>`), so a printed code keeps working as long as
 * the link does.
 */

const fs = require('node:fs');
const path = require('node:path');
const { sampleClient, requiredEnv, env } = require('../_common/bootstrap');
const { PaymentLinkQrFormat } = require('../../src');

(async () => {
  const linkId = requiredEnv('LUNIXI_PAYMENT_LINK_ID');
  const format = env('LUNIXI_QR_FORMAT', PaymentLinkQrFormat.PNG);
  const image = await sampleClient().paymentLinks.qr(linkId, { format, size: 1024 });

  const file = path.resolve(env('LUNIXI_QR_OUT', `payment-link-${linkId}.${format}`));
  fs.writeFileSync(file, image.data);
  console.log(`${image.contentType}, ${image.data.length} bytes → ${file}`);
})();
