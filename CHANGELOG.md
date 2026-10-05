# Changelog

All notable changes to `@lunixi/node-sdk`.

## 0.5.0

### Added

- **Wallet** (`client.wallet`) — the merchant server-to-server surface,
  `/api/v1/wallet/*` (60 routes). Every call is signed.
  - `ping()`
  - `programs`: `listMine()`, `setCollectionAnchor(programId, options)`
  - `endUsers`: `create(request, idempotencyKey)`, `list(filters)` / `iterate(filters)`,
    `get(id)`, `getByExternalId(externalCustomerId, programId)`,
    `freeze(id, options, idempotencyKey)`, `getBalances(id)`, `getKycLevel(id)`,
    `updateKycLevel(id, request, idempotencyKey)`, `getLimits(id, filters)`,
    `createWallet(id, options, idempotencyKey)`
  - `wallets`: `createAccount(walletId, currency, idempotencyKey)`, `lookup(request)`
  - `deposits`: `listInstructions(endUserId)`, `createInstruction(endUserId, options)`,
    `simulateInboundCredit(request)` (test)
  - `corporate`: `create`, `list` / `iterate`, `importEmployees`, `offboardEmployees`
  - `fees`: `quote(request)`
  - `transfers`: `quoteW2W`, `initiateW2W`, `completeW2W`, `quoteW2Iban`,
    `initiateW2Iban`, `completeW2Iban` — `endUserId` is required; the complete
    calls put `operationId` in the body for you
  - `withdrawals`: `quote`, `initiate`, `complete`, `get` (to the end user's own bank account)
  - `operations`: `list` / `iterate`, `get`, `getReceipt`
  - `topups`: `startCard`, `get`, `refund`, `agent`
  - `payments`: `request`, `approve` (`buyerEndUserId` required), `collect`, `get`, `getCommission`
  - `qr`: `create`, `list` / `iterate`, `get`, `image` (SVG/PNG bytes), `revoke`, `parse`
  - `bulkPayouts`: `create`, `list`, `get`, `listItems`, `submit`, `approve`, `reject`,
    `process`, `retryFailed`
- `WALLET_ROUTES` — the route table the client validates against (method, path,
  Idempotency-Key rule, accepted body and query fields), and the wallet enums
  (`WalletAccountType`, `WalletKycLevel`, `WalletOtpChannel`, `WalletQrType`, …).
- Samples `samples/08-wallet/`.

## 0.4.0

### Added

- **`fraud.report.ready`** webhook event type (`FraudEvents.REPORT_READY`). The
  platform catalogue publishes seven `FRAUD_SERVICE` event types and the SDK
  carried six, so an endpoint subscribed to scheduled reports had no constant to
  branch on. The event carries NO download link: download links are short-lived
  and produced from the console.

### Changed

- `fraud.events.record()` and `recordBatch()` now have result typings
  (`FraudEventResult`, `FraudEventBatchResult`) instead of a bare `JsonObject`.
  The batch typing names `failed` and `results[].error`, because the endpoint
  answers `200` even when some events were rejected — reading only the HTTP
  status loses events silently.

## 0.3.0

### Added

- **Payment links** (`client.paymentLinks`) — `/api/v1/payments/links`:
  - `create(request, idempotencyKey)` — the `Idempotency-Key` is required; the
    same key with the same body returns the stored link with `replayed: true`.
  - `list(filters)` / `iterate(filters)` — cursor pages, newest first
    (`state`, `usage`, `amountMode`, `tag`, `branchCode`, `createdById`,
    `query`, `createdFrom`/`createdTo`).
  - `get(id)`, `update(id, expectedRowVersion, changes)` — only the keys you
    pass change; `null` clears a field. `usage`, `amountMode` and `currency`
    are fixed at creation and are refused locally.
  - `pause` / `resume` / `deactivate`, `send` (e-mail or SMS; the
    `Idempotency-Key` is required so a retry cannot send twice), `qr`
    (SVG or PNG bytes), `listAttempts` / `listPayments` (+ `iterate…`).
  - Link images: `uploadImage({ fileName, contentType, content })` uploads a
    PNG, JPEG or WebP image and resolves with the published image, whose
    `assetId` is what `withImageAssetId()` takes. The steps are available one
    by one too: `createImageUpload({ fileName, contentType, sizeBytes })`
    (`POST /images`, the presigned upload URL) and
    `confirmImageUpload(assetId)` (`POST /images/:assetId/confirm`), which
    resolves only with a published image.
- **Builders**: `CreatePaymentLinkRequest` (`fixed`, `open`, `itemized`),
  `PaymentLinkItem`, `PaymentLinkCustomField`. Money is checked to be an
  integer in minor units; a decimal amount is a local error. Closed value
  sets (`usage`, `amountMode`, `locale`, `buttonLabelKey`, buyer-field
  requirements, custom-field types) and the keys of `buyerFields`,
  `recipient` and `prefill` are checked locally, so a typo fails with its
  name instead of as a 400.
- **Value sets**: `PaymentLinkUsage`, `PaymentLinkAmountMode`,
  `PaymentLinkState`, `PaymentLinkAttemptState`, `PaymentLinkEnvironment`,
  `BuyerFieldRequirement`, `CustomFieldType`, `PaymentLinkButtonLabel`,
  `PaymentLinkDeliveryChannel`, `PaymentLinkQrFormat`, `PaymentLinkLocale`,
  `PaymentLinkImageContentType`, and `PAYMENT_LINK_SPEC_FIELDS`.
- `ApiClient.request(…, { binary: true })` returns `{ contentType, data }`
  for image responses.
- Samples under `samples/07-payment-links/`.

### Notes

- Payment-link routes accept the API-key signature only. Every call — reads
  included — is sent signed (`stepUp`). The key needs the `payment-link:*`
  scopes; keys created before payment links do not have them.
- The key decides the environment: a TEST key creates and sees only TEST links.
  `withEnvironment()` is optional and must match the key.
- Create and update bodies are checked against the gateway's field list, so an
  unknown key fails locally with its name instead of as a 400.
- The image upload's PUT goes straight to the storage host behind the
  presigned URL, not through the gateway client: it carries only the upload
  headers, never the access token or the request signature. Both image routes
  need the `payment-link:create` scope. SVG is not accepted, and an image
  declared over 2 MiB is refused before anything is uploaded.

## 0.2.0

### Added

- **Fraud module** (`client.fraud`), covering the customer fraud surface:
  - `fraud.evaluate(request)` — `POST /api/v1/fraud/decisions/evaluate`.
  - `fraud.events.record(event)` / `fraud.events.recordBatch(events)` —
    `POST /api/v1/fraud/events/transactions(/batch)`. These sign every request
    (Ed25519 step-up); the signature is what binds an event to your merchant.
  - `fraud.decisions.list(filters)` / `.get(traceId)` / `.latestForPayment(id)` /
    `.iterate(filters)` — cursor-paginated decision logs.
- **Request dictionaries** exported as `fraud` (channels, surfaces, stages,
  operation kinds, auth modes, product contexts) so a closed-dictionary value is
  never a hand-typed string.
- **`FraudEvents` / `FRAUD_EVENT_TYPES`** — the six fraud webhook event types a
  merchant endpoint can subscribe to. Internal event-bus topics (`*.v1`) are not
  webhook types and are not listed.
- **`FraudDecisionValue`** — `allow` / `review` / `block` / `force_3d`.
- **Typed errors**: `ValidationError` (400), `RateLimitError` (429) and
  `ServiceUnavailableError` (503). The retry errors carry `retryAfter` and a
  `quota` snapshot read from the response headers. A header the gateway did not
  send stays `null` — the SDK never guesses a limit, because retrying at an
  invented rate is worse than not knowing it.
- Samples under `samples/06-fraud/`.

### Notes

- `evaluate()` validates against the accepted field list and rejects unknown
  fields locally, with the offending key named. The gateway runs
  `forbidNonWhitelisted`, so those fields would be a 400 anyway; failing locally
  turns a round trip into a readable error.
- `tenantId` is deliberately not an accepted field: it is stamped from the access
  token and a body value is ignored.

## 0.1.0

- Initial release: auth (Ed25519 signing, token manager), payments, v2 webhook
  verifier.
