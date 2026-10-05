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
- `paymentLinks.create`
- `paymentLinks.send`
- `wallet.*` calls that create or move something (`endUsers.create`, `transfers.initiateW2W`/`completeW2W`, `payments.request`/`approve`, `topups.startCard`, `qr.create`, `bulkPayouts.create`, …) — the client refuses to send them without one; the full list is `WALLET_ROUTES[name].idempotencyKey`

Use a deterministic key per merchant operation, and reuse the same key when retrying the same operation.

## Payment links

`client.paymentLinks` creates and manages shareable payment links
(`https://pay.lunixi.com/<code>`). These routes accept the API-key signature
only, so every call is signed; the key needs the `payment-link:create`,
`:view`, `:manage` and `:send` scopes. The key decides the environment — a
TEST key creates and sees only TEST links.

```js
const { CreatePaymentLinkRequest, PaymentLinkUsage } = require('@lunixi/node-sdk');

// Build the body from your own record, not from the current time: a retry with
// the same Idempotency-Key must send the same body (a different body is 409).
const request = CreatePaymentLinkRequest.fixed(PaymentLinkUsage.SINGLE_USE, 150000, 'TRY', 'Consulting fee')
  .withExpiresAt(invoice.dueAt) // a Date or an ISO-8601 string in the future
  .withReference(invoice.number)
  .withRecipient({ email: invoice.customerEmail });

const link = await lunixi.paymentLinks.create(request, `plink-${invoice.number}`);
console.log(link.url);

// Changes create a new version; pass the rowVersion you read.
await lunixi.paymentLinks.update(link.id, link.rowVersion, { title: 'Consulting fee (October)' });

for await (const row of lunixi.paymentLinks.iterate({ state: ['ACTIVE', 'PAUSED'] })) {
  console.log(row.shortCode, row.paidCount);
}
```

Amounts are integers in minor units (`150000` = 1,500.00 TRY). Fulfil orders
from the `payment.captured` webhook, whose payload carries `paymentLinkId` and
`paymentLinkCode`.

### Link images

```js
const fs = require('node:fs');
const { PaymentLinkImageContentType } = require('@lunixi/node-sdk');

const image = await lunixi.paymentLinks.uploadImage({
  fileName: 'cover.png',
  contentType: PaymentLinkImageContentType.PNG,
  content: fs.readFileSync('cover.png'),
});

// The published image's assetId goes on a link (or an item) as imageAssetId.
await lunixi.paymentLinks.update(link.id, link.rowVersion, { imageAssetId: image.assetId });
```

`uploadImage()` asks the gateway for a presigned upload URL, PUTs the file
straight to the storage host and confirms it; media then checks the stored bytes
(PNG, JPEG or WebP, never SVG; at most 2 MiB and 4096×4096 px). The PUT carries
only the upload headers, never your access token or request signature. Both
image routes need the `payment-link:create` scope.

To upload from somewhere else (a browser, a worker), run the steps yourself:
`createImageUpload({ fileName, contentType, sizeBytes })` returns
`{ assetId, uploadUrl, uploadMethod: 'PUT', uploadHeaders, expiresAt }`; PUT the
file to `uploadUrl` with exactly `uploadHeaders` before `expiresAt`, then call
`confirmImageUpload(assetId)`.

## Wallet

`client.wallet` is the merchant (server-to-server) side of the closed-loop
wallet, `/api/v1/wallet/*`: end users and their wallets, balances and limits,
wallet-to-wallet and IBAN transfers, bank withdrawals, card and agent top-ups,
payments to your shop, QR codes, corporate accounts and bulk payouts.

Every call is signed with the API key. The key needs the `WALLET_SERVICE`
product and the permission behind the call — a missing one is 403
`WALLET_INSUFFICIENT_SCOPE`:

| Calls | Permission |
|---|---|
| `ping()` | a manage permission (`wallet:program:manage`) |
| reads (`get*`, `list*`, quotes) | `wallet:program:read`, `wallet:enduser:read`, `wallet:operation:read`, `wallet:qr:read` |
| end users, wallets, accounts, limits, fees set-up | `wallet:program:manage`, `wallet:enduser:manage` |
| KYC level | `wallet:enduser:kyc-override` |
| money inside the wallet: W2W, payments, collect, top-ups, top-up refund | `wallet:operation:intervene` |
| IBAN transfers and bank withdrawals (open-loop plan) | `wallet:bank-payout:operate` |
| QR create / revoke | `wallet:qr:manage` |
| bulk payout create, corporate accounts | `wallet:bulk:create` |
| bulk payout submit / approve / process / retry | `wallet:bulk:approve` (a different key than the creator) |

Money moves in two steps: `initiate*` reserves the limit and returns
`operationId`, `integrityHash`, `nonce` and `otpRequired`; `complete*` sends the
same `integrityHash` and `nonce` back (plus the OTP the end user received).
Calls that move an end user's money name that end user (`endUserId`, or
`buyerEndUserId` on payment approval); an account that is not theirs is 404
`WALLET_NOT_FOUND`.

```js
const wallet = client.wallet;
const transfer = {
  endUserId,                        // whose money it is
  sourceWalletAccountId,
  destinationWalletNo: '1234567890',
  amount: '12550',                  // minor units: 125.50 TRY
  currency: 'TRY',
};

const quote = await wallet.transfers.quoteW2W(transfer);
const started = await wallet.transfers.initiateW2W(
  { ...transfer, scheduleVersionId: quote.scheduleVersionId, otpChannel: 'SMS' },
  `w2w-init-${transferId}`,
);
const done = await wallet.transfers.completeW2W(started.operationId, {
  endUserId,
  integrityHash: started.integrityHash,
  nonce: started.nonce,
  otpCode,                          // when started.otpRequired
}, `w2w-complete-${transferId}`);
```

- Amounts are minor-unit digit strings (`"12550"`). A safe integer number is
  sent as its digit string; a float is refused before the request leaves.
- Bodies are checked against `WALLET_ROUTES` before sending: an unknown field, a
  missing required field or a missing `Idempotency-Key` is a
  `ConfigurationError`, not a 400 from the gateway.
- List calls return `{ items, nextCursor, hasMore, raw }`; `iterate()` follows
  the cursor.
- `wallet.qr.image(id, { format: 'svg' | 'png', scale })` returns
  `{ contentType, data: Buffer }`.
- Final outcomes arrive as webhooks (`wallet.transfer.completed`,
  `wallet.payment.completed`, `wallet.topup.completed`,
  `wallet.withdrawal.completed`, `*.failed`, `*.reversed`). The wallet fields
  are under the delivery's `data`.

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
node samples/07-payment-links/create-invoice-link.js
node samples/08-wallet/transfer-w2w.js
```

Sample groups:

- `01-auth`: keypair generation and token fetch
- `02-payments`: checkout intent, direct 2D/3D, capture, refund, void
- `03-cards`: verify-and-store, list/get/deactivate, stored-card charge
- `04-reporting`: payment lookup/listing, BIN/installments/taxonomy, analytics
- `05-webhooks`: signature verification and Express raw-body endpoint
- `06-fraud`: standalone decision, event feed, decision logs
- `07-payment-links`: create (invoice, tickets), list, update and pause, send, QR, payments, image upload
- `08-wallet`: end user, balances, W2W transfer, payment request, card top-up, QR, bulk payout, operations
- `express`: minimal Express integration server
- `nestjs`: provider/module/service/controller sample for NestJS applications
