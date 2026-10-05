'use strict';

/**
 * Uploads a link image and shows it on a link.
 *
 * `uploadImage()` asks the gateway for a presigned upload URL, PUTs the file
 * straight to the storage host (with only the upload headers: never your
 * access token or signature) and confirms it. Media then checks the stored
 * bytes: PNG, JPEG or WebP (never SVG), at most 2 MiB and 4096×4096 px.
 */

const fs = require('node:fs');
const path = require('node:path');
const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');
const { PaymentLinkImageContentType } = require('../../src');

const CONTENT_TYPES = {
  '.png': PaymentLinkImageContentType.PNG,
  '.jpg': PaymentLinkImageContentType.JPEG,
  '.jpeg': PaymentLinkImageContentType.JPEG,
  '.webp': PaymentLinkImageContentType.WEBP,
};

(async () => {
  const links = sampleClient().paymentLinks;
  const file = requiredEnv('LUNIXI_IMAGE_FILE');
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!contentType) throw new Error('LUNIXI_IMAGE_FILE must be a .png, .jpg, .jpeg or .webp file.');

  const image = await links.uploadImage({ fileName: path.basename(file), contentType, content: fs.readFileSync(file) });

  const linkId = requiredEnv('LUNIXI_PAYMENT_LINK_ID');
  const current = await links.get(linkId);
  const updated = await links.update(linkId, current.rowVersion, { imageAssetId: image.assetId });
  print({ assetId: image.assetId, url: image.url, linkVersion: updated.version });
})();
