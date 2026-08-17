'use strict';

const crypto = require('node:crypto');
const { SignatureError } = require('../errors');

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

class Ed25519Signer {
  constructor(privateKey) {
    this.privateKey = normalizePrivateKey(privateKey);
  }

  sign(message) {
    try {
      return crypto.sign(null, Buffer.from(message, 'utf8'), this.privateKey).toString('base64');
    } catch (error) {
      throw new SignatureError(`Ed25519 signing failed: ${error.message}`, { cause: error });
    }
  }

  publicKeyPem() {
    return crypto.createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
  }

  static generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  }
}

function normalizePrivateKey(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SignatureError('Empty Ed25519 private key.');
  }

  const trimmed = input.trim();
  if (trimmed.includes('-----BEGIN')) {
    try {
      return crypto.createPrivateKey({ key: trimmed, format: 'pem', type: 'pkcs8' });
    } catch (error) {
      throw new SignatureError('Unsupported Ed25519 private key PEM.', { cause: error });
    }
  }

  const material = decodeKeyMaterial(trimmed);
  if (material.length === 48 && material.subarray(0, 16).equals(PKCS8_PREFIX)) {
    return crypto.createPrivateKey({ key: material, format: 'der', type: 'pkcs8' });
  }
  if (material.length === 32) {
    return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, material]), format: 'der', type: 'pkcs8' });
  }
  if (material.length === 64) {
    return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, material.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  }

  throw new SignatureError('Unsupported Ed25519 private key; expected PKCS#8 PEM or raw seed.');
}

function decodeKeyMaterial(value) {
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return Buffer.from(value);
  }
}

module.exports = { Ed25519Signer, PKCS8_PREFIX, SPKI_PREFIX };
