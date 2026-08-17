# Lunixi Node.js SDK

Server-side Node.js SDK for Lunixi payment integrations. The SDK is framework-agnostic and works with Express, Fastify, NestJS, Hapi, serverless functions, and plain Node.js.

Requires Node.js 18+.

## Install locally

```bash
npm install
npm test
```

The SDK itself has no Express dependency. Express is used only by the sample app:

```bash
npm install express
node samples/express/server.js
```

## NestJS usage

NestJS projects can use the same SDK through a provider. See:

- `samples/nestjs/lunixi.module.ts`
- `samples/nestjs/payments.service.ts`
- `samples/nestjs/payments.controller.ts`

The important pattern is to create one `LunixiClient` provider and inject it into your application service:

```ts
@Injectable()
export class MerchantPaymentsService {
  constructor(@Inject(LUNIXI_CLIENT) private readonly lunixi: LunixiClient) {}
}
```

To smoke-test the checkout form with the same private key used by
`pos-form-main/create-intent-test.mjs`, run:

```bash
DRY_RUN=1 node samples/nestjs/create-checkout-content.js

KID=mk_live_sk_... \
CALLBACK_URL=http://localhost:8080/payment.html \
node samples/nestjs/create-checkout-content.js
```

If you are testing against an older gateway deployment that still exposes a
different auth route, override it explicitly:

```bash
TOKEN_PATH=/api/v1/auth/token node samples/nestjs/create-checkout-content.js
```

The script writes `pos-form-main/public/checkout-content.json`, which
`pos-form-main/public/payment.html` auto-loads and renders.

## Express usage

```js
const express = require('express');
const {
  LunixiClient,
  CreateIntentRequest,
  Buyer,
  Address,
  BasketItem,
} = require('@lunixi/node-sdk');

const lunixi = new LunixiClient({
  baseUrl: process.env.LUNIXI_BASE_URL,
  keyId: process.env.LUNIXI_KEY_ID,
  privateKey: process.env.LUNIXI_PRIVATE_KEY,
});

const app = express();
app.use(express.json());

app.post('/checkout', async (req, res, next) => {
  try {
    const request = new CreateIntentRequest(10050, 'TRY', `ORD-${Date.now()}`)
      .withCallbackUrl('https://merchant.example/payment/callback')
      .withBuyer(new Buyer({
        name: 'Ada',
        surname: 'Yilmaz',
        identityNumber: '11111111111',
        email: 'ada@example.com',
        gsmNumber: '+905350000000',
        city: 'Istanbul',
        country: 'Turkey',
        zipCode: '34000',
        ip: req.ip,
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
          price: 10050,
          name: 'Demo Product',
          category1: 'Demo',
          itemType: BasketItem.TYPE_PHYSICAL,
        }),
      ]);

    const intent = await lunixi.payments.createIntent(request, `checkout:${request.toJSON().orderId}`);
    res.json(intent);
  } catch (error) {
    next(error);
  }
});
```

## Idempotency

Money-moving SDK calls require a stable `Idempotency-Key`:

- `capture`
- `refund`
- `void`
- `chargeCard2d`
- `chargeCard3d`
- `storeCard`
- `deactivateStoredCard`

Use a deterministic key per merchant operation, and reuse the same key when retrying the same operation.

## Direct card payments

Direct 2D/3D card payments are PCI-sensitive and require full business context. The SDK rejects card-only direct payments. Use `DirectPaymentRequest` with `buyer`, `billingAddress`, and at least one `basketItem`.

## Samples

Copy `samples/.env.example` to `samples/.env`, then run any sample with Node:

```bash
node samples/01-auth/generate-keypair.js
node samples/02-payments/create-checkout-intent.js
node samples/02-payments/direct-3d-payment.js
node samples/03-cards/store-card-with-3ds.js
node samples/04-reporting/list-payments.js
```

Sample groups:

- `01-auth`: keypair generation and token fetch
- `02-payments`: checkout intent, direct 2D/3D, capture, refund, void
- `03-cards`: verify-and-store, list/get/deactivate, stored-card charge
- `04-reporting`: payment lookup/listing, BIN/installments/taxonomy, analytics
- `05-webhooks`: signature verification and Express raw-body endpoint
- `express`: minimal Express integration server
- `nestjs`: provider/module/service/controller sample for NestJS applications
