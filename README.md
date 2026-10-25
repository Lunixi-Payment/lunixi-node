<p align="center">
  <a href="https://lunixi.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Lunixi-Payment/lunixi-node/main/.github/assets/lunixi-logo-dark.svg">
      <img src="https://raw.githubusercontent.com/Lunixi-Payment/lunixi-node/main/.github/assets/lunixi-logo.svg" alt="Lunixi" height="64">
    </picture>
  </a>
</p>

# Lunixi Node.js SDK

[![CI](https://github.com/Lunixi-Payment/lunixi-node/actions/workflows/ci.yml/badge.svg)](https://github.com/Lunixi-Payment/lunixi-node/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@lunixi/node-sdk)](https://www.npmjs.com/package/@lunixi/node-sdk) [![Downloads](https://img.shields.io/npm/dm/@lunixi/node-sdk)](https://www.npmjs.com/package/@lunixi/node-sdk) [![Node.js](https://img.shields.io/node/v/@lunixi/node-sdk)](https://nodejs.org) [![Types](https://img.shields.io/npm/types/@lunixi/node-sdk)](https://www.npmjs.com/package/@lunixi/node-sdk) [![License](https://img.shields.io/npm/l/@lunixi/node-sdk)](LICENSE) [![Docs](https://img.shields.io/badge/docs-docs.lunixi.com-FF6B35)](https://docs.lunixi.com/sdks/node)

**[Documentation](https://docs.lunixi.com/sdks/node) · [Changelog](https://github.com/Lunixi-Payment/lunixi-node/blob/main/CHANGELOG.md) · [Issues](https://github.com/Lunixi-Payment/lunixi-node/issues) · [Security](https://github.com/Lunixi-Payment/lunixi-node/blob/main/SECURITY.md)**

Server-side Node.js SDK for Lunixi payment integrations. The SDK is framework-agnostic and works with Express, Fastify, NestJS, Hapi, serverless functions, and plain Node.js.

Requires Node.js 18+.

## Install

```bash
npm install @lunixi/node-sdk
```

The SDK has no runtime dependencies. TypeScript type definitions are included.

## Development

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

## Amounts

`amount` is the only amount field of a payment request: the intent
(`CreateIntentRequest`, also for `createMarketplaceIntent`) and `direct/payment`
(`DirectMethodPaymentRequest`, card included) both take it as their first argument.

- It is the basket total in minor units: an integer, at least 1
  (`10050` = 100.50 TRY). Anything else throws `ConfigurationError`.
- With basket items, the items' `price` values must add up to `amount`.
- `amount` does not include an installment fee. For an installment charge send
  the installment count and the quote token from `payments.installmentOptions()`
  (`withInstallment(count, quoteToken)` on `DirectMethodPaymentRequest`; on the hosted form
  the buyer picks the installment). The system adds the fee to the charged amount.
- `price` and `paidPrice` are no longer request fields. A raw body that carries
  either is refused with `ConfigurationError` before sending; the gateway answers
  it with 400 `payment.amount.field_removed`.
- Marketplace: the sellers' `amountMinor` values must add up to `amount`.
- In responses and webhooks `amount` is the charged amount, installment fee
  included.

## Basket items and insurance

`itemType` is `PHYSICAL` or `VIRTUAL` on every endpoint. A basket item sent to
`createIntent` (Checkout Form) can also carry the optional insurance fields, so
the checkout can offer insurance for it:

```js
const { BasketItem, InsuranceItemCategory } = require('@lunixi/node-sdk');

new BasketItem({
  id: 'item-1',
  price: 100000,
  name: 'Izmir-Ankara train ticket',
  category1: 'ticket',
  itemType: BasketItem.TYPE_VIRTUAL,
  insuranceCategory: InsuranceItemCategory.TICKET,
  insuranceTypes: ['TICKET_CANCELLATION'],
  insuranceContext: { transportMode: 'TRAIN', departureAt: '2027-06-15T09:30:00+03:00' },
});
```

- `insuranceCategory` (`InsuranceItemCategory`: `TICKET`, `HOTEL`, `EVENT`,
  `DEVICE`, `ELECTRONICS`, `VEHICLE`, `TRAVEL`, `HOME`, `HEALTH`, `PET`,
  `MICROMOBILITY`, `MUSICAL_INSTRUMENT`, `SHIPMENT`, `EDUCATION`) is required
  when `insuranceTypes`, `insuranceValueAmount` or `insuranceContext` is sent.
  `insuranceEligible: false` turns insurance off for the item.
- `insuranceValueAmount` is the insured value of one unit in minor units
  (default: the unit price).
- `insuranceContext` takes the category's keys (`BasketItemInsuranceContext`);
  it carries no personal data and an unknown key is a 400. A key the item's
  insurance type uses prefills that field; the buyer can change it.
- `insuranceData` (`BasketItemInsuranceData`) carries what the quote needs that
  only you know, so the buyer is not asked again: the root fields of the type's
  quote body (`policyholder`, `insured`, the type object such as `tickets` or
  `device`). A list type object (`tickets`) is one object for the item, without
  `basketItemId`. Partial data is allowed; when nothing is missing the Checkout
  Form prices the insurance on its own (the buyer still ticks the box). It is
  personal data: Lunixi stores it encrypted for the quote only and erases it
  after the payment intent expires. See
  `samples/10-insurance/checkout-with-insurance-data.js`.

```js
new BasketItem({
  id: 'item-1', price: 100000, name: 'Izmir-Ankara train ticket', category1: 'ticket',
  itemType: BasketItem.TYPE_VIRTUAL, insuranceCategory: InsuranceItemCategory.TICKET,
  insuranceData: {
    insured: [{ identityType: 'PASSPORT', identityNumber: '…', birthDate: '…' }],
    tickets: { pnr: '…', ticketNumber: '…' },
  },
});
```

- `insurance.listProducts({ currency, paymentIntentId })` then returns per
  product `prefill`, `providedFields` (masked), `quoteReady` and
  `insuranceDataIssues`; with `quoteReady`, `createQuote({ insuranceType,
  currency, paymentIntentId })` needs no type fields.
- With any insurance field in the basket, item `id`s must be unique.
- `directMethodPayment` (`direct/payment`) answers these fields with 400. They never reach the
  payment provider, and the payment goes on when insurance is not offered.

## Idempotency

Money-moving SDK calls require a stable `Idempotency-Key`:

- `capture`
- `refund`
- `void`
- `directMethodPayment`
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

## Bank accounts

`client.bankConnect` reads your connected bank accounts
(`/api/v1/bank-connect`): banks, connections, accounts, balances and
transactions, plus a request for a fresh read. Connecting a bank and entering
bank credentials happen in the Lunixi dashboard.

Every call is signed. The key needs the BANK_CONNECT product,
`bank-connect:view` (banks, connections, accounts, `requestSync`) and
`bank-connect:transactions:view` (balances, transactions), and decides the
environment — a TEST key reads only test-environment accounts.

```js
const { BankTransactionDirection, RateLimitError } = require('@lunixi/node-sdk');

for await (const account of client.bankConnect.iterateAccounts()) {
  console.log(account.ibanMasked, account.freshness.lastSuccessfulSyncAt);
}

// Newest recorded first; bookedFrom/bookedTo filter on the bank date, at most 92 days apart.
for await (const transaction of client.bankConnect.iterateTransactions({
  bookedFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  direction: BankTransactionDirection.CREDIT,
})) {
  matchOrder(transaction.description, transaction.amountMinor); // 150000 = 1,500.00 TRY
}

try {
  const sync = await client.bankConnect.requestSync(accountId); // 202: QUEUED or SCHEDULED
} catch (error) {
  if (error instanceof RateLimitError) console.log(`retry in ${error.retryAfter}s`);
}
```

- Lists return `{ items, hasMore, nextCursor }`; `iterate…()` follows the cursor.
- A field without a value is left out of the response. Amounts are integers in
  minor units; IBANs and counterparty names are masked.
- Filters are checked before sending: an unknown filter, a value outside its
  set or a window over 92 days is a `ConfigurationError`.
- New transactions arrive by the `bank_account.transaction.received` webhook
  (`BankConnectEvents.TRANSACTION_RECEIVED`); its `data` is typed as
  `BankAccountTransactionReceivedData`. Dedupe on `event.id`.

### Transfers and currency exchange

Available on a connection whose `capabilities` include `OUTGOING_TRANSFER` /
`FX_EXCHANGE`. The key needs `bank-connect:transfer` **and an IP allowlist**;
a request from an unlisted IP is `403 bank_connect.auth.ip_not_allowed`. With
an API key there is no e-mail code: a transfer or an exchange order is
`SUBMITTED` at once and queued for the bank.

```js
const { BankTransferStatus } = require('@lunixi/node-sdk');

// Idempotency-Key: pass your own to retry safely across processes; one is generated otherwise.
const { transfer, replayed } = await client.bankConnect.transfers.create({
  accountId,
  receiverIban: 'TR050006200000000000000146',
  receiverName: 'Örnek Tedarik A.Ş.',
  amountMinor: 150075, // 1,500.75 TRY
  description: 'Invoice 2026-0042',
}, `payout-${payoutId}`);

const latest = await client.bankConnect.transfers.get(transfer.id);
if (latest.status === BankTransferStatus.FAILED) console.log(latest.failureCode);

// Exchange: quote, then order before quote.expiresAt.
const quote = await client.bankConnect.fx.createQuote({
  sourceAccountId: tryAccountId, targetAccountId: usdAccountId, targetAmountMinor: 100000, // buy 1,000.00 USD
});
const { order } = await client.bankConnect.fx.createOrder({ quoteId: quote.id });
```

- Transfer webhooks: `BankTransferEvents` (`bank_transfer.created|completed|failed|returned`),
  `data` typed as `BankTransferWebhookData`. Exchange orders have no webhook.
- Unlike the read routes, a transfer, quote or order field without a value is `null`.
## Insurance

`client.insurance` sells and services insurance for your basket items
(`/api/v1/insurance`, product INSURANCE_SERVICE). Every call is signed; the key
decides the environment. Amounts are integers in minor units.

Collecting the premium in your own Lunixi payment:

```js
const { BasketItem, CreateIntentRequest, InsuranceClient, InsuranceItemCategory } = require('@lunixi/node-sdk');

const ticket = new BasketItem({
  id: 'ticket-1', price: 100000, name: 'Izmir-Ankara train ticket', category1: 'ticket',
  itemType: BasketItem.TYPE_VIRTUAL, insuranceCategory: InsuranceItemCategory.TICKET,
  insuranceTypes: ['TICKET_CANCELLATION'],
});

// 1. Eligibility: an empty list means insurance is not offered.
const { products } = await client.insurance.searchProducts({ currency: 'TRY', context: { items: [ticket] } });

// 2. Quote with the same items and the type's fields (products[].fields lists them).
const quote = await client.insurance.createQuote({
  insuranceType: 'TICKET_CANCELLATION', currency: 'TRY', merchantOrderId: 'ORD-1042',
  context: { items: [ticket] }, insured, tickets, // from your checkout form
});
const option = quote.options[0];

// 3. The buyer accepts the option's terms.
const order = await client.insurance.createOrder({
  quoteId: option.quoteId,
  consent: InsuranceClient.consentFromQuote(option, new Date()),
}, 'ins-order:ORD-1042');

// 4. Pay the insured items plus the premium item; amount is the sum.
const premium = InsuranceClient.premiumBasketItem(order, { name: 'Ticket cancellation insurance', category1: 'insurance' });
const created = await client.payments.createIntent(
  new CreateIntentRequest(100000 + order.premiumAmount, 'TRY', 'ORD-1042').withBasketItems([ticket, premium]) /* buyer, addresses … */,
  'checkout:ORD-1042',
);

// 5. Bind the order to the payment. The policy is requested once the payment is captured.
await client.insurance.bindPayment(order.orderId, (created.data ?? created).paymentId, 'ins-bind:ORD-1042');
```

- The basket of a quote is either a payment's recorded basket
  (`paymentIntentId`) or the items you will send in the payment
  (`context.items`); both is a `ConfigurationError`. To collect the premium in
  a Lunixi payment, quote with `context.items`.
- Insurance sold without a basket item: `listProducts({ currency })` without
  `paymentIntentId` lists those types, and `createQuote()` with neither
  `paymentIntentId` nor `context` prices one (the insured value is in the type
  object). A type sold only with a basket item answers that quote with 412
  `insurance.type.not_available`.
- An option names the insurance company (`underwriter: { code, name, logoUrl,
  disclosureText }`) apart from the provider (`provider`); the same company
  from two providers comes as two options with the same `underwriter.code`.
  `excludedOptions[]` lists the companies the request could not be priced
  with (`errorCode`, `errors[{ field, reason }]`); only they are left out.
  In `listProducts()` / `searchProducts()` a field may carry `requiredAt` and
  `requiredBy[{ underwriterCode, stage }]` when only some companies need it.
- The type's own fields (`insured` and the type object named by
  `InsuranceProduct.typeObject`: `tickets`, `stay`, `device`, `product`,
  `vehicle`, `trip`, `rental`, `instrument`, `event`, `accident`, `procedure`,
  `pet`, `residence`, `abroadStay`) are passed through as given.
  Policy-stage fields (e.g. PNR, ticket number, the insured's e-mail and phone)
  are sent with the quote. A rule violation is a 422
  `insurance.validation.invalid` whose `error.response.details.errors` lists
  every `{ field, reason }` at once.
- `premiumBasketItem()` builds `{ id: orderId, itemType: 'VIRTUAL', price:
  premiumAmount }` for an order whose premium you collect
  (`premiumCollectedBy: MERCHANT`); a `PROVIDER` order has no premium item.
- Premium collected outside Lunixi: `confirmPayment(orderId, { externalPaymentId,
  paidAmount, paidCurrency, paidAt }, key)`, then `issuePolicy(orderId, key)`.
- `cancelOrder()` cancels the issued policies (asynchronous, `CANCEL_PENDING`);
  it does not refund. `refundPremium()` refunds from the Lunixi payment, or
  records your own refund with `{ externalRefund: { externalRefundId, refundedAt } }`.
- `createOrder`, `confirmPayment`, `issuePolicy`, `cancelOrder` and
  `refundPremium` require an `Idempotency-Key` (8–200 printable ASCII
  characters, no spaces); `createQuote` and `bindPayment` take one optionally.
- `getPolicyDocument(policyId)` returns the PDF (`{ contentType, data }`);
  `getPolicyReceipt(policyId)` and `getPolicyCertificate(policyId)` return the
  provider's receipt and certificate the same way, only for products that issue
  them (otherwise 412 `insurance.document.not_supported`);
  `exportReconciliation({ from, to })` returns the CSV with `truncated` and
  `nextCursor` for files over 20000 orders. `getReconciliationSummary()` and
  `listReconciliationOrders()` read the same report as JSON.
- `listReferenceValues(kind)` reads the Lunixi codes a type field takes
  (`InsuranceReferenceKind`, e.g. `OCCUPATION`, `MEDICAL_PROCEDURE_COVER`,
  `PET_BREED`). `DISTRICT`, `DEVICE_MODEL`, `VEHICLE_MODEL`, `BANK_BRANCH` and
  `PET_BREED` need `parentCode` (province, brand, bank, `CAT` | `DOG`).
- Lists return `{ items, hasMore, nextCursor }`; `iterate…()` follows the cursor.
  Request fields and filters are checked before sending: an unknown field or a
  malformed value is a `ConfigurationError`.
- Webhooks (`insurance.*`): `InsuranceEvents.POLICY_ISSUED`, `POLICY_FAILED`,
  `REFUND_REQUIRED`, `POLICY_DOCUMENT_READY`, `POLICY_CANCELLED`,
  `REFUND_COMPLETED`; `data` is typed as `InsuranceWebhookData`. Decide on the
  order from the webhook and dedupe on `event.id`. `LEAD_SUBMITTED`
  (`insurance.lead.submitted`) carries a lead summary instead
  (`InsuranceLeadWebhookData`: `lead.leadId`, `insuranceType`, `status`, no
  personal data).
- The provider collecting the premium itself (`premiumCollectedBy: PROVIDER`)
  cannot be completed through the API yet.

### Leads

Some insurance types are sold by request only: the provider gives no quote, so
there is no premium, order, policy or document. `createLead()` sends the
request to the provider with your own connection, in the call:

```js
const lead = await client.insurance.createLead({
  insuranceType: 'MOTOR_COMPREHENSIVE',
  policyholder: { identityType: 'TCKN', identityNumber, birthDate, email, phone },
  vehicle: { plate, registrationDocument: { serial, number } },
  note: 'Call in the afternoon',
}, 'lead:ORD-1042');
// lead.status: SUBMITTED (the provider received it) or UNKNOWN (not known; it is not sent again)
```

- The fields follow the type's lead schema (`policyholder`, the type object,
  optional `note` up to 1000 characters): `MOTOR_THIRD_PARTY_LIABILITY` and
  `MOTOR_COMPREHENSIVE` take `vehicle`; `CARGO_TRANSIT` takes `shipment`, the
  carrying `vehicle` and an optional `company` (tax identity). A lead has no
  amount, currency, basket item or payment (`INSURANCE_LEAD_FIELDS`).
- The `Idempotency-Key` is required; the same key with the same body returns
  the same lead. A provider refusal is 422 `insurance.lead.rejected`; a type or
  connection without leads is 412 `insurance.type.not_available`.
- `listLeads({ insuranceType, status })` / `iterateLeads()` and
  `getLead(leadId)` read your leads; `requestMasked` shows the lead as sent with
  the personal fields and the note masked. `InsuranceLeadStatus`: `PENDING`,
  `SUBMITTED`, `UNKNOWN`, `FAILED` (`errorCode`).

## Sanctions screening

`client.sanction` covers the API-key routes of `/api/v1/sanction/*` (product
`SANCTION_SERVICE`, permission `sanction:view_results`). Calls carry the access
token minted from your key; no per-request signature.

```js
const { isClearScreening, SanctionRiskDomain, ServiceUnavailableError } = require('@lunixi/node-sdk');

try {
  const result = await client.sanction.screenName({
    name: 'Ayla Kurgu',
    subjectType: 'person',
    country: 'TR',
    riskDomains: [SanctionRiskDomain.SANCTIONS, SanctionRiskDomain.PEP],
    customerReference: 'cust_84213',
  });
  if (isClearScreening(result)) {
    // no match AND coverageStatus COMPLETE
  } else {
    // a match, or PARTIAL / DEGRADED coverage (see result.uncoveredRiskDomains): review
  }
  await client.sanction.registerMonitoring({ externalCustomerId: 'cust_84213', profile: { name: 'Ayla Kurgu' } });
} catch (error) {
  if (error instanceof ServiceUnavailableError) {
    // 503: no list publication could be pinned, the screening did NOT run. Hold as "not screened".
  }
  throw error;
}
```

- **Matches, not verdicts.** `isClearScreening(result)` is true only with no match
  or hit and, where the answer reports coverage, `coverageStatus: 'COMPLETE'`. A
  wallet's `publicationHits` (listed parties holding the address) are separate
  from `hits` (your own list and crypto intelligence). Public procurement ban
  screening stays `PARTIAL` while the Turkish KİK list is unpublished
  (`uncoveredSources`).
- **Ids:** `result.screeningRequestId` is the screening's id; the envelope's
  `requestId` is the HTTP request's.
- Bodies and filters are checked before sending against `SANCTION_ROUTES`
  (unknown field, unknown risk domain or mode, missing party/account →
  `ConfigurationError`): the gateway forwards the body to the sanction service,
  which would drop an unknown field without an error.
- Lists (`listScreeningHistory`, `listMonitoringAlerts`, `listMonitoredEntities`,
  `listMonitoringMatches`, `listBlacklistEntries`) return
  `{ items, nextCursor, hasMore, totalCount, raw }`, each with an `iterate…`.
- Not in the SDK: the screening report PDF (panel session only), adding deny-list
  entries, analyst decisions and case assignment (permissions an API key does
  not carry), list-source syncs.

## Pre-authorization (preauth)

`withPreauth(true)` holds the amount on the card instead of capturing it. The
payment becomes `AUTHORIZED`; take it with `payments.capture()` or release it with
`payments.void()`. It is available on `CreateIntentRequest` (hosted checkout and
`createMarketplaceIntent`) and on `DirectMethodPaymentRequest` (`direct/payment`, card included). Without
it, or with `withPreauth(false)`, the amount is captured immediately.

```js
const request = new CreateIntentRequest(10050, 'TRY', 'ORD-1042').withPreauth(true);
const intent = await lunixi.payments.createIntent(request, 'checkout:ORD-1042');
// later, once the payment is AUTHORIZED:
await lunixi.payments.capture(paymentId, null, 'capture:ORD-1042');
```

## Direct card payments

A card is charged from your server with `payments.directMethodPayment()`
(`POST /api/v1/payments/direct/payment`, `paymentMethod: CARD`). The former
`chargeCard2d()` / `chargeCard3d()` methods and the direct 2D/3D card
endpoints were removed (0.11.0). Direct card payments are PCI-sensitive (SAQ-D):
most merchants should use the hosted checkout (`createIntent()`).

- `withCard(card)`: a new card (`cardHolderName`, `cardNumber`, `expireMonth`,
  `expireYear`, `cvcNumber`) or a stored card (`cardUserKey` + `cardToken`).
- `withForce3D(true)`: 3D Secure. The response is HTTP 202 with a `REDIRECT`
  action; send the buyer to `data.action.redirect.url`. Without it the card is
  charged without 3D Secure; the bank may still ask for it with the same action.
- `withInstallment(count, quoteToken)` with the quote from
  `payments.installmentOptions()`; the system adds the installment fee.
- Send `buyer`, `billingAddress` and `basketItems` with the card.

```js
const request = new DirectMethodPaymentRequest(15000, 'TRY', 'ORD-1042')
  .withCard(card)
  .withForce3D(true)
  // installment count and the quote from payments.installmentOptions(); the system adds the fee
  .withInstallment(3, quoteToken)
  .withCallbackUrl('https://merchant.example/payment/callback')
  .withBuyer(buyer)
  .withBillingAddress(billingAddress)
  .withBasketItems(basketItems);
const result = await lunixi.payments.directMethodPayment(request, 'pay:ORD-1042');
// result.data.action.redirect.url → the bank's 3D Secure page
```

Migrating from `chargeCard2d(new DirectPaymentRequest(amount, currency, orderId, card, buyer, billingAddress, basketItems))`:
`new DirectMethodPaymentRequest(amount, currency, orderId).withCard(card).withBuyer(buyer).withBillingAddress(billingAddress).withBasketItems(basketItems)`,
then `directMethodPayment(request, idempotencyKey)`; for `chargeCard3d` add
`.withForce3D(true)`. The other setters keep their names.

## Payment methods (Faturana Yansıt, wallets, promissory notes, card)

`payments.directMethodPayment()` starts a payment with any payment method from
your server (`POST /api/v1/payments/direct/payment`), card included (see
"Direct card payments"). The hosted checkout (`createIntent()`) works unchanged.

1. `payments.listPaymentMethods()` lists the methods open for your account;
   `listPaymentMethods({ paymentMethod: PaymentMethod.MOBILE_BILLING })` lists
   one method (`{ methods: [] }` when it is not open, 400
   `payment.method.unknown` for an unknown code). For each method: `blockName`,
   `providerSelection` (`ROUTED` card, `OPTIONAL` `providerCode` may be omitted,
   `REQUIRED` send `providerCode`), `providerSelectionMode` (see below),
   `preauth` support, amount limits, `splitEligible` / `splitBehavior` (split
   payments) and the providers with the `inputFields` they ask the buyer for.
   Methods and providers come in the order set in your form settings (the
   platform's default order when you set none); show them in this order. A
   provider turned off only in the checkout form stays in the list and can be
   used through the API.
2. Build the body with `DirectMethodPaymentRequest` and choose the method with
   `withMethodFields(method, providerCode, fields)` (card: `withCard(card)`). The
   fields are the provider's `inputFields`; a field with `prefill` may be omitted
   when the value is in `buyer`.
3. When the buyer must act the response is HTTP 202 with `data.action`:
   - `OTP`: send the code with `payments.confirmPaymentAction(paymentId, actionId, { otp })`;
     `payments.resendPaymentAction(paymentId, actionId)` sends a new code and
     returns a new `action.id`.
   - `REDIRECT`: send the buyer to `data.action.redirect.url` (card with
     `withForce3D(true)`: the bank's 3D Secure page). The buyer returns to
     `callbackUrl` with the signed result form.
   - `INPUT`: send the values listed in `action.input.fields` as `{ fields }`.
4. The final result also arrives by webhook (`payment.captured`,
   `payment.failed` …) with `paymentMethod` and `providerCode`.

```js
const { DirectMethodPaymentRequest, PaymentMethod, PaymentActionType } = require('@lunixi/node-sdk');

const [method] = (await lunixi.payments.listPaymentMethods({ paymentMethod: PaymentMethod.MOBILE_BILLING })).data.methods;
const provider = method.providers[0]; // the provider your buyer picked

const request = new DirectMethodPaymentRequest(5000, 'TRY', 'ORD-1042')
  .withMethodFields(PaymentMethod.MOBILE_BILLING, provider.providerCode, { gsmNumber: '+905321234567' })
  .withCallbackUrl('https://merchant.example/payment/callback');

const started = await lunixi.payments.directMethodPayment(request, 'pay:ORD-1042');
if (started.data.action?.type === PaymentActionType.OTP) {
  // later, with the code the buyer entered:
  await lunixi.payments.confirmPaymentAction(started.data.paymentId, started.data.action.id, { otp: '123456' });
}
```

### Who picks the provider

In the Checkout Form the buyer always picks the provider of a non-card method
(with one provider no picker is shown and that provider is used).
`providerSelectionMode` (`ProviderSelectionMode`) is the API behaviour, when
your own page or server sends the payment:

- `BUYER`: with more than one provider connected `providerSelection` is
  `REQUIRED` and a request without `providerCode` is refused with 400
  `payment.provider.required`. Show the providers (`displayName`, `logoUrl`)
  and send the chosen one.
- `PLATFORM` (Faturana Yansıt): `providerCode` may be left out. The platform then
  picks one of the connected providers before any money moves and keeps it for
  the payment. When you let your buyer pick (as the Checkout Form does with more
  than one provider), send the chosen `providerCode`. When none of the connected
  providers can take a payment without `providerCode` the answer is 422
  `payment.provider.none_eligible`: nothing was charged and
  `error.response.details.candidates[]` gives each provider's `outcome`
  (`INELIGIBLE`, or `UNAVAILABLE` / `NOT_CHECKED`, which may succeed on a later
  try).

`providerSelection === 'REQUIRED'` remains the rule for when `providerCode` must
be sent; `providerSelectionMode` adds whether the buyer should see the choice.

```js
const { ProviderSelection, PaymentMethod } = require('@lunixi/node-sdk');

const [method] = (await lunixi.payments.listPaymentMethods({ paymentMethod: PaymentMethod.WALLET })).data.methods;

let providerCode = null;
if (method.providers.length > 1) {
  providerCode = await askBuyerToPick(method.providers); // your page: displayName + logoUrl, in this order
} else if (method.providerSelection === ProviderSelection.REQUIRED) {
  providerCode = method.providers[0].providerCode;
}
// PLATFORM without a pick: providerCode stays null; the platform picks the provider.

const request = new DirectMethodPaymentRequest(5000, 'TRY', 'ORD-1043')
  .withMethodFields(method.paymentMethod, providerCode, fields);
```

- A declined payment is HTTP 400 and throws `ValidationError`; `error.response.data`
  carries `paymentId` and `status`.
- A wrong code is HTTP 422 (`ApiError`); the action stays open and
  `error.response.details.attemptsRemaining` tells how many tries are left.
- `withPreauth(true)` holds the amount (`AUTHORIZED`). A method whose providers
  do not support it is refused with 422 `payment.preauth.unsupported_for_method`
  (`preauth: false` in the list).
- A merchant server confirms with its signature. The SDK never sends the
  checkout token fields (`token`, `checkoutSessionProof`); those belong to the
  hosted form.

## Split payments

`payments.createSplitPayment()` funds one payment with several legs
(`POST /api/v1/payments/split`): stored cards of the same owner and, when split
payments with other methods are enabled in your form settings, non-card methods
with the same block as `direct/payment`. The platform sets the order of the
legs and returns it as `steps`. Leg amounts are minor units and add up to
`totalAmount`; 1 to 5 legs. The builder checks the rules before sending
(`ConfigurationError`): known fields only, one leg per card and per provider,
card fields only on card legs, `callbackUrl` with a 3D Secure leg, an
installment quote from 2 installments, `noteCount` (no schedule) on a
promissory-note leg.

Docs: [Split Payments](https://docs.lunixi.com/payments/split-payments),
[Multiple Cards](https://docs.lunixi.com/payments/split-payments/multi-card),
[Multiple Payment Methods](https://docs.lunixi.com/payments/split-payments/multi-method).

### Multiple cards

Card legs only. Each card leg has its own 3D Secure (`force3D`, then
`withCallbackUrl()` is required) and its own installments. An installment
quote is taken with that leg's amount, without an intent.

```js
const { SplitPaymentRequest, InstallmentOptionsRequest } = require('@lunixi/node-sdk');

// Card B in 3 installments: quote with the leg's amount and the stored card's BIN.
const quote = await lunixi.payments.installmentOptions(
  new InstallmentOptionsRequest(40000, 'TRY').withBinOrPan(cardBBin).withInstallment(3),
);

const request = new SplitPaymentRequest(100000, 'TRY', cardUserKey)
  .withOrderId('ORD-1050')
  .withCallbackUrl('https://merchant.example/payment/callback')
  .addCardLeg(cardAToken, 60000, { force3D: true })
  .addCardLeg(cardBToken, 40000, { installment: 3, installmentQuoteToken: quote.data.quoteToken });

const key = 'split:ORD-1050'; // the identity of this split payment; reuse it on every call
const split = (await lunixi.payments.createSplitPayment(request, key)).data;
// Card A waits for 3D Secure: split.pendingStep.step === 'THREE_DS' (see "Completing the pending step").
```

`cardAToken` / `cardBToken` are stored card tokens of `cardUserKey`. The cards
are processed in the order you add them.

### Multiple payment methods

Several cards together with non-card methods. Use providers with
`splitEligible: true` from `listPaymentMethods()`; `splitBehavior`
(`SplitBehavior`) tells how a provider is charged. The platform holds the cards
first (each with its own 3D Secure and installments), then charges reversible
methods (wallet), and the non-reversible method (Faturana Yansıt, promissory
note; at most one) last. More than one card needs the "Pay with Multiple
Cards" switch in your form settings; four legs need "Maximum parts" of at
least 4.

```js
const { SplitPaymentRequest, PaymentMethod } = require('@lunixi/node-sdk');

const { methods } = (await lunixi.payments.listPaymentMethods()).data;
const splitProvider = (code) =>
  methods.find((method) => method.paymentMethod === code)?.providers.find((provider) => provider.splitEligible);
const wallet = splitProvider(PaymentMethod.WALLET);
const mobileBilling = splitProvider(PaymentMethod.MOBILE_BILLING);

// 2 cards + wallet + Faturana Yansıt = 100000
const request = new SplitPaymentRequest(100000, 'TRY', cardUserKey)
  .withOrderId('ORD-1051')
  .withCallbackUrl('https://merchant.example/payment/callback')
  .addCardLeg(cardAToken, 30000, { force3D: true })
  .addCardLeg(cardBToken, 25000, { installment: 3, installmentQuoteToken: cardBQuoteToken })
  .addMethodLeg(PaymentMethod.WALLET, wallet.providerCode, 20000, { gsmNumber: buyerGsm })
  .addMethodLeg(PaymentMethod.MOBILE_BILLING, mobileBilling.providerCode, 25000, { gsmNumber: buyerGsm });

const key = 'split:ORD-1051';
const split = (await lunixi.payments.createSplitPayment(request, key)).data;
```

`buyerGsm` is the number your buyer entered for the wallet and Faturana Yansıt
(the provider's `inputFields`). The method fields are not stored: send the
same request with the same key on every call.

### Reading the steps

`steps` is the order the platform set, one entry per leg (`SplitPaymentStep`);
`pendingStep` is what the payment waits for, `null` when nothing waits on you.
`expiresAt` is the end of the payment window (`null` for cards only or once
the non-reversible leg has started).

```js
const { SplitStepKind } = require('@lunixi/node-sdk');

for (const step of split.steps) {
  const leg = step.kind === SplitStepKind.CARD ? 'card' : `${step.paymentMethod} (${step.providerCode})`;
  console.log(`${step.sequence}. ${leg} ${step.splitBehavior} ${step.amount} ${step.status}${step.current ? ' <- waiting' : ''}`);
}
```

### Completing the pending step

`pendingStep.step` (`SplitPendingStep`) tells you what to do. After each step
call `createSplitPayment()` again with the same request and the same key: no new
payment is created (`duplicate: true`) and the answer carries the current
steps.

- `THREE_DS`: send the buyer to `redirectPath` on `https://api-gateway.lunixi.com`;
  the buyer returns to your `callbackUrl`.
- `ACTION`: the buyer's code for a non-card leg. Confirm it with
  `confirmPaymentAction(pendingStep.paymentId, pendingStep.actionId, { otp })`;
  `resendPaymentAction()` sends a new code.
- `START_METHOD`: the next non-card leg is waiting to start; call again.
- `RESULT_PENDING`, `CREDIT_APPROVAL`: wait. Read it later with
  `getSplitPayment(splitPaymentId)`; the result also arrives by webhook.

```js
const { SplitPendingStep } = require('@lunixi/node-sdk');

const GATEWAY = 'https://api-gateway.lunixi.com';

async function nextSplitStep(request, key, codeFromBuyer = null) {
  const split = (await lunixi.payments.createSplitPayment(request, key)).data;
  const pending = split.pendingStep;
  if (!pending) return { split };
  switch (pending.step) {
    case SplitPendingStep.THREE_DS:
      return { split, redirectTo: new URL(pending.redirectPath, GATEWAY).toString() };
    case SplitPendingStep.ACTION: {
      if (!codeFromBuyer) return { split, askBuyerForCode: true };
      const input = { otp: codeFromBuyer };
      if (pending.action?.consent?.required) input.consentAccepted = true;
      await lunixi.payments.confirmPaymentAction(pending.paymentId, pending.actionId, input);
      return nextSplitStep(request, key);
    }
    case SplitPendingStep.START_METHOD:
      return nextSplitStep(request, key);
    default:
      return { split }; // RESULT_PENDING, CREDIT_APPROVAL: wait for the webhook
  }
}
```

### Errors (`split_pay.*`)

- A rule broken before sending throws `ConfigurationError`; nothing was sent.
- Rule violations found by the gateway are HTTP 422 with a
  `split_pay.validation.*` code (`SplitPayErrorCode`, `ApiError`); nothing was
  charged. `error.response.details` gives the limit (`min`, `max`,
  `minLegAmount`, `minAmount`, `maxAmount`).
- While the payment runs the gateway answers HTTP 400 with the status as
  `code`; `createSplitPayment()` returns that answer
  (`SPLIT_PAYMENT_IN_PROGRESS_STATUSES`) instead of throwing.
- A failed payment (`VOIDED`, `FAILED`, `COMPENSATING`,
  `RECONCILIATION_REQUIRED`) throws `ValidationError` with the split in
  `error.response.data`. The same key keeps returning this payment; a new
  attempt needs a new key.
- `split_pay.step.busy` (409): another request is processing the payment;
  retry shortly with the same key. `split_pay.step.not_allowed` (409): read the
  current step and follow it (`details.reason`).

```js
const { ApiError, ValidationError, SplitPayErrorCode } = require('@lunixi/node-sdk');

try {
  const result = await nextSplitStep(request, key, codeFromBuyer);
  // show result.redirectTo / ask for the code / wait for the webhook
} catch (error) {
  if (error instanceof ValidationError && error.response?.data?.splitPaymentId) {
    // the split payment failed: error.code is its status, error.response.data.steps its legs
  } else if (error instanceof ApiError && error.code === SplitPayErrorCode.STEP_BUSY) {
    // retry in a few seconds with the same request and key
  } else if (error instanceof ApiError && error.code === SplitPayErrorCode.LEG_OUTSIDE_PROVIDER_LIMITS) {
    const { minAmount, maxAmount } = error.response.details; // move the leg into this range
  } else if (error instanceof ApiError && error.code?.startsWith('split_pay.')) {
    // see the Split Payments error table for what to do
  } else {
    throw error;
  }
}
```

Error codes and what to do: [Split Payments › Errors](https://docs.lunixi.com/payments/split-payments#errors).

### Refunds, listing and webhooks

- `getSplitPayment(id)` returns the legs with `chargeAmount`, `capturedAmount`,
  `refundedAmount`, `refundState` and `dispute`, and `refund` / `dispute` of the
  main payment. `listSplitPayments({ status: ['COMPLETED', 'VOIDED'], limit: 25 })`
  pages with `after: pageInfo.endCursor`.
- `refundSplitPayment(id, amount, reason, key)` refunds the main payment: card
  legs first (partial allowed), then the other refundable legs in full; a
  non-reversible leg is never refunded. `split_pay.refund.incomplete` carries the
  per-leg result in `error.response.data`; retry with the same key. The main
  payment of a Checkout Form split is refunded with `refund()`.
- `list({ includeLegs: true })` also returns each leg as a row; `split.role` is
  `PARENT` on the main payment and `LEG` on a leg.
- Webhooks: deliver the order on the main payment's `payment.captured` /
  `payment.failed` (`settlementMode: 'SPLIT'`, `legs[]`). `SplitPaymentEvents`
  lists the split events; add `SPLIT_LEG_EVENTS_SUBSCRIPTION` to an endpoint's
  event types to also receive each leg's events.

## Senetle Ödeme (promissory notes)

`paymentMethod: PROMISSORY_NOTE` issues promissory notes (or payment orders,
by your provider connection settings) through the provider's API. There is no
buyer action: on success the payment is `CAPTURED` at once. The money does not
pass through Lunixi; each note is collected at its due date from the debtor to
your own account.

- Debtor and guarantor fields are the provider's `inputFields`
  (`payments.listPaymentMethods()`), sent in the `promissoryNote` block with
  `withMethodFields(PaymentMethod.PROMISSORY_NOTE, providerCode, fields)`. Field
  types include `ADDRESS` (`{ provinceCode, districtCode, neighborhoodCode, line }`,
  codes from `client.reference`), `GROUP` (a list of objects, e.g. guarantors)
  and `VKN`. A field with `requiredWhen: { field, equals }` is required only when
  that sibling field has that value, and must be left out otherwise.
- The plan is either a schedule or a note count, never both:
  - `withPromissoryNoteSchedule([{ amount, dueDate }])`: amounts in minor units
    adding up to `amount`, `YYYY-MM-DD` due dates after today (Istanbul) in
    ascending order, at most 24 rows;
  - `withPromissoryNoteCount(count)`: the amount is split evenly (the remaining
    minor units go to the last note) and due dates follow your connection
    settings. Allowed counts are the `noteCount` options in `inputFields`.
- On the hosted form, `CreateIntentRequest.withPromissoryNoteSchedule(schedule)`
  fixes the plan; without it the buyer chooses the number of notes.

```js
const { DirectMethodPaymentRequest, PaymentMethod } = require('@lunixi/node-sdk');

const request = new DirectMethodPaymentRequest(300000, 'TRY', 'ORD-2001')
  .withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, {
    debtorType: 'INDIVIDUAL',
    birthDate: '1990-01-01',
    address: { provinceCode: '06', districtCode: '1001', neighborhoodCode: '2001', line: 'Example Street 1' },
  })
  .withPromissoryNoteSchedule([
    { amount: 100000, dueDate: '2030-01-15' },
    { amount: 200000, dueDate: '2030-02-15' },
  ])
  .withBuyer(buyer);

const payment = await lunixi.payments.directMethodPayment(request, 'pay:ORD-2001');
const notes = await lunixi.payments.getPromissoryNotes(payment.data.paymentId);
const pdf = await lunixi.payments.downloadPromissoryNoteDocument(payment.data.paymentId, 'tr-TR');
// pdf.contentType === 'application/pdf', pdf.data is a Buffer
```

- `getPromissoryNotes(paymentId)`: serial number, sequence, amount, due date and
  `status` (`ISSUED`, `PAID`, `PROTESTED`, `CANCELLED`) of each note.
- `cancelPromissoryNotes(paymentId, serialNumbers?)`: cancels the given notes,
  or every open note; the answer carries `cancelResults[]` per note (`CANCELLED`,
  `ALREADY_CLOSED`, `NOT_CANCELLABLE` for a collected note, `FAILED`) and an
  `errorCode` that is always a Lunixi code (`PromissoryNoteCancelErrorCode`):
  `payment.promissory_note.not_cancellable`, `…provider_unavailable` (temporary,
  cancel again later) or `…cancel_rejected` (permanent); `null` otherwise. The
  payment stays `CAPTURED`. Partial refunds do not apply to notes.
- `downloadPromissoryNoteDocument(paymentId, locale?)`: the printable notes as a
  PDF (`tr-TR` default, `en-GB`); built on request and not stored.
- `client.reference.listProvinces()`, `listDistricts(provinceCode)`,
  `listNeighborhoods(districtCode)`: address codes. An empty list means that
  level is not published yet.
- Webhooks (`PromissoryNoteEvents`): `payment.promissory_note.paid`,
  `payment.promissory_note.protested`, `payment.promissory_note.cancelled`; the
  payload adds `promissoryNote: { serialNumber, sequence, amountMinor, dueDate,
  status, occurredAt }`. Statuses are polled from the provider, so an event
  arrives some time after the due date.
- Errors: a malformed schedule (not a list, more than 24 rows, a non-integer
  amount, a date format, an extra key) is `400 VALIDATION_ERROR` from the gateway
  (the SDK stops it before sending); the plan and field rules are
  `400 payment.method.block_invalid` with `details.errors[] = { field, reason }`
  (e.g. `promissoryNote.schedule[2].dueDate` / `not_in_future`; an intent schedule
  with another pinned method: `not_allowed_for_<METHOD>`);
  `422 payment.provider.not_available`; `404 payment.promissory_note.not_found`;
  `503 payment.promissory_note.document_unavailable`.

## Samples

Copy `samples/.env.example` to `samples/.env`, then run any sample with Node:

```bash
node samples/01-auth/generate-keypair.js
node samples/02-payments/create-checkout-intent.js
node samples/02-payments/create-preauth-checkout-intent.js
node samples/02-payments/direct-method-card-payment.js
node samples/02-payments/list-payment-methods.js
node samples/02-payments/mobile-billing-otp-payment.js
node samples/02-payments/promissory-note-payment.js
node samples/02-payments/split-payment.js
node samples/03-cards/store-card-with-3ds.js
node samples/04-reporting/list-payments.js
node samples/07-payment-links/create-invoice-link.js
node samples/08-wallet/transfer-w2w.js
node samples/09-bank-accounts/list-accounts.js
node samples/10-insurance/offer-insurance-in-payment.js
```

Sample groups:

- `01-auth`: keypair generation and token fetch
- `02-payments`: checkout intent, pre-authorized checkout intent, payment methods list, Faturana Yansıt with OTP, promissory notes, split payment (stored card + Faturana Yansıt), card through `directMethodPayment`, capture, refund, void
- `03-cards`: verify-and-store, list/get/deactivate, stored-card charge
- `04-reporting`: payment lookup/listing, BIN/installments/taxonomy, analytics
- `05-webhooks`: signature verification and Express raw-body endpoint
- `06-fraud`: standalone decision, event feed, decision logs
- `07-payment-links`: create (invoice, tickets), list, update and pause, send, QR, payments, image upload
- `08-wallet`: end user, balances, W2W transfer, payment request, card top-up, QR, bulk payout, operations
- `09-bank-accounts`: connections and accounts with freshness, balances, incoming transfers matched to orders, fresh-read request, transaction webhook endpoint
- `10-insurance`: ticket cancellation insurance sold with your payment (eligibility, quote, order, premium item, bind), insurance data on the checkout item (prefill, quote on the payment), premium collected outside Lunixi with policy request, cancel and refund, policy PDF, orders, reconciliation summary and CSV, reference codes, webhook endpoint
- `express`: minimal Express integration server
- `nestjs`: provider/module/service/controller sample for NestJS applications
