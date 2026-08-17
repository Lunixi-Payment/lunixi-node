'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  LunixiClient,
  Buyer,
  Address,
  BasketItem,
} = require('../../src');

loadEnv(path.join(__dirname, '..', '.env'));

function sampleClient() {
  return new LunixiClient({
    baseUrl: env('LUNIXI_BASE_URL', 'https://api.lunixi.io'),
    keyId: requiredEnv('LUNIXI_KEY_ID'),
    privateKey: privateKey(),
  });
}

function privateKey() {
  const keyPath = env('LUNIXI_PRIVATE_KEY_PATH');
  if (keyPath) return fs.readFileSync(keyPath, 'utf8');

  const inline = env('LUNIXI_PRIVATE_KEY');
  if (inline) return inline.replace(/\\n/g, '\n');

  throw new Error('Set LUNIXI_PRIVATE_KEY_PATH or LUNIXI_PRIVATE_KEY.');
}

function env(key, fallback = null) {
  return process.env[key] && process.env[key] !== '' ? process.env[key] : fallback;
}

function requiredEnv(key) {
  const value = env(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function idempotencyKey(prefix) {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

function sampleBuyer(ip = '127.0.0.1') {
  return new Buyer({
    name: env('LUNIXI_BUYER_NAME', 'Ada'),
    surname: env('LUNIXI_BUYER_SURNAME', 'Yilmaz'),
    identityNumber: env('LUNIXI_BUYER_IDENTITY_NUMBER', '11111111111'),
    email: env('LUNIXI_BUYER_EMAIL', 'ada@example.com'),
    gsmNumber: env('LUNIXI_BUYER_GSM', '+905350000000'),
    city: env('LUNIXI_BUYER_CITY', 'Istanbul'),
    country: env('LUNIXI_BUYER_COUNTRY', 'Turkey'),
    zipCode: env('LUNIXI_BUYER_ZIP', '34000'),
    ip,
  });
}

function sampleBillingAddress() {
  return new Address({
    address: env('LUNIXI_BILLING_ADDRESS', 'Example Street 1'),
    zipCode: env('LUNIXI_BILLING_ZIP', '34000'),
    contactName: env('LUNIXI_BILLING_CONTACT', 'Ada Yilmaz'),
    city: env('LUNIXI_BILLING_CITY', 'Istanbul'),
    country: env('LUNIXI_BILLING_COUNTRY', 'Turkey'),
  });
}

function sampleBasketItems(amount) {
  return [
    new BasketItem({
      id: env('LUNIXI_BASKET_ITEM_ID', 'SKU-001'),
      price: amount,
      name: env('LUNIXI_BASKET_ITEM_NAME', 'Demo Product'),
      category1: env('LUNIXI_BASKET_ITEM_CATEGORY', 'Demo'),
      itemType: BasketItem.TYPE_PHYSICAL,
    }),
  ];
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [rawKey, ...parts] = line.split('=');
    const key = rawKey.trim();
    let value = parts.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

module.exports = {
  sampleClient,
  env,
  requiredEnv,
  idempotencyKey,
  sampleBuyer,
  sampleBillingAddress,
  sampleBasketItems,
  print,
};
