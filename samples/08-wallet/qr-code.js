'use strict';

/**
 * A dynamic merchant QR for one amount, saved as an SVG file.
 *
 * Static QR codes carry no amount (the payer types it); dynamic ones require it
 * and expire after `expiresInSeconds`.
 *
 * The API key needs `wallet:qr:manage`.
 */

const fs = require('node:fs');
const { sampleClient, env, print } = require('../_common/bootstrap');
const { WalletQrType } = require('../../src');

(async () => {
  const wallet = sampleClient().wallet;
  const orderRef = env('LUNIXI_WALLET_ORDER_REF', 'ord-0001');

  const qr = await wallet.qr.create({
    qrType: WalletQrType.MERCHANT_DYNAMIC,
    currency: 'TRY',
    amount: env('LUNIXI_WALLET_AMOUNT', '4990'),
    expiresInSeconds: 600,
    metadata: { orderRef },
  }, `wallet-qr-${orderRef}`);

  const image = await wallet.qr.image(qr.id, { format: 'svg', scale: 6 });
  const file = env('LUNIXI_WALLET_QR_FILE', `./wallet-qr-${orderRef}.svg`);
  fs.writeFileSync(file, image.data);
  print({ id: qr.id, status: qr.status, file, contentType: image.contentType });
})();
