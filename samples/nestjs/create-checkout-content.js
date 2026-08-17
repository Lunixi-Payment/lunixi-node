'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LunixiClient,
  CreateIntentRequest,
  Buyer,
  Address,
  BasketItem,
} = require('../../src');

const repoRoot = path.resolve(__dirname, '../../../..');
const defaultPrivateKeyPath = path.join(repoRoot, 'pos-form-main/key.private.pem');
const defaultPaymentHtmlPath = path.join(repoRoot, 'pos-form-main/public/payment.html');
const defaultOutputPath = path.join(repoRoot, 'pos-form-main/public/checkout-content.json');

function env(name, fallback = null) {
  return process.env[name] && process.env[name].trim() !== '' ? process.env[name].trim() : fallback;
}

function required(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function readPrivateKey() {
  if (env('PRIV_PEM')) return env('PRIV_PEM').replace(/\\n/g, '\n');
  const explicitKeyPath = env('PRIV', env('LUNIXI_PRIVATE_KEY_PATH'));
  if (explicitKeyPath) return fs.readFileSync(explicitKeyPath, 'utf8');

  const paymentHtmlKey = readPaymentHtmlPrivateKey(defaultPaymentHtmlPath);
  if (paymentHtmlKey) return paymentHtmlKey;

  return fs.readFileSync(defaultPrivateKeyPath, 'utf8');
}

function readPaymentHtmlPrivateKey(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const html = fs.readFileSync(filePath, 'utf8');
  const match = html.match(/LOCAL_TEST_PEM\s*=\s*'([^']+)'/);
  return match ? match[1].replace(/\\n/g, '\n') : null;
}

async function main() {
  const keyId = env('KID', env('LUNIXI_KEY_ID'));
  const callbackUrl = env('CALLBACK_URL', 'http://localhost:8080/payment.html');
  const amount = Number(env('AMOUNT_MINOR', '10050'));
  const currency = env('CURRENCY', 'TRY');
  const orderId = env('ORDER_ID', `node-sdk-form-${Date.now()}`);
  const outputPath = env('OUT', defaultOutputPath);

  if (env('DRY_RUN') === '1') {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      needsKeyId: !keyId,
      privateKeySource: env('PRIV', env('LUNIXI_PRIVATE_KEY_PATH'))
        ? 'env-path'
        : fs.existsSync(defaultPaymentHtmlPath)
          ? 'pos-form-main/public/payment.html'
          : defaultPrivateKeyPath,
      outputPath,
      callbackUrl,
      orderId,
    }, null, 2));
    return;
  }

  if (!keyId) throw new Error('Set KID or LUNIXI_KEY_ID. payment.html does not contain this; it is server-side merchant key metadata.');

  const client = new LunixiClient({
    baseUrl: env('API_BASE', env('LUNIXI_BASE_URL', 'https://api-gateway.lunixi.com')),
    authTokenPath: env('TOKEN_PATH', '/api/v1/auth/token'),
    keyId,
    privateKey: readPrivateKey(),
  });

  const request = new CreateIntentRequest(amount, currency, orderId)
    .withCallbackUrl(callbackUrl)
    .withDescription('Node/Nest SDK checkout form smoke test')
    .withMetadata({
      allowedOrigin: new URL(callbackUrl).origin,
      checkoutOrigin: new URL(callbackUrl).origin,
    })
    .withBuyer(new Buyer({
      name: 'Ada',
      surname: 'Yilmaz',
      identityNumber: '11111111111',
      email: 'ada@example.com',
      gsmNumber: '+905350000000',
      city: 'Istanbul',
      country: 'Turkey',
      zipCode: '34000',
      ip: '127.0.0.1',
    }))
    .withBillingAddress(new Address({
      address: 'Example Street 1',
      zipCode: '34000',
      contactName: 'Ada Yilmaz',
      city: 'Istanbul',
      country: 'Turkey',
    }))
    .withBasketItems([
      new BasketItem({
        id: 'SKU-001',
        price: amount,
        name: 'Demo Product',
        category1: 'Demo',
        itemType: BasketItem.TYPE_PHYSICAL,
      }),
    ]);

  const intent = await client.payments.createIntent(request, `checkout:${orderId}`);
  if (env('DEBUG_RESPONSE') === '1') {
    console.log(JSON.stringify({
      rawIntentResponse: intent,
    }, null, 2));
  }

  const data = intent.data && typeof intent.data === 'object' ? intent.data : intent;
  const html = data.checkoutFormContent || intent.checkoutFormContent;
  if (!html) throw new Error(`Intent response did not include checkoutFormContent: ${JSON.stringify(intent)}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    html,
    token: data.token || intent.token || null,
    paymentId: data.paymentId || intent.paymentId || null,
    at: new Date().toISOString(),
  }, null, 2));

  console.log(JSON.stringify({
    ok: true,
    paymentId: data.paymentId || intent.paymentId || null,
    outputPath,
    secureFields: /secureFields/.test(html),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
