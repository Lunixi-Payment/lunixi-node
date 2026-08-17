'use strict';

const crypto = require('node:crypto');

const HEADER_KEY_ID = 'X-Key-Id';
const HEADER_DATE = 'X-Date';
const HEADER_NONCE = 'X-Nonce';
const HEADER_SIGNATURE = 'X-Signature';
const HEADER_DIGEST = 'Digest';
const DIGEST_PREFIX = 'SHA-256=';

function buildCanonicalRequest(method, url, date, nonce, digest = null) {
  const lines = [
    String(method).toUpperCase(),
    url,
    `${HEADER_DATE}:${date}`,
    `${HEADER_NONCE}:${nonce}`,
  ];
  if (digest) lines.push(`${HEADER_DIGEST}:${digest}`);
  return lines.join('\n');
}

function digestForBody(rawBody) {
  if (!rawBody) return null;
  return DIGEST_PREFIX + crypto.createHash('sha256').update(rawBody).digest('base64');
}

module.exports = {
  HEADER_KEY_ID,
  HEADER_DATE,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  HEADER_DIGEST,
  DIGEST_PREFIX,
  buildCanonicalRequest,
  digestForBody,
};
