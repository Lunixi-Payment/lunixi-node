# Changelog

All notable changes to `@lunixi/node-sdk`.

## 0.20.0

Insurance data on a basket item. Additive: no export, method or field was
removed. The gateway and the Checkout Form that prefills and prices it are live.

### Added

- `BasketItemFields.insuranceData` with its type `BasketItemInsuranceData`:
  the root fields of the insurance type's quote body (`policyholder`,
  `insured`, one type object such as `tickets`, `device`, `vehicle`, `trip`,
  `property` or `health`). A list type object is one object for the item,
  without `basketItemId`. Partial data is allowed. `BasketItem` sends it as
  given; the gateway checks the shape (400 with the field path, never the
  value).
- `InsuranceProduct.prefill`, `providedFields` (`InsuranceProvidedField`:
  `path`, `masked`), `quoteReady` and `insuranceDataIssues`
  (`InsuranceDataIssue`: `basketItemId`, `field`, `reason`).
- Sample `samples/10-insurance/checkout-with-insurance-data.js`: a checkout
  intent with insurance data, the products of the payment and a quote with
  only `insuranceType`, `currency` and `paymentIntentId`.

### Changed

- First release on npm: `npm install @lunixi/node-sdk`. `package.json` names
  the public repository and publishes with public access.
- `BasketItemInsuranceContext` documentation: the keys a type uses now prefill
  that field (the buyer can change them); a key the type does not use is left
  out. `createQuote()` documents the merge with the recorded data.

## 0.19.0

Split payments (one payment funded by stored cards and non-card methods) and
payment options (provider order, a provider turned off only in the checkout
form). Requires the gateway release with split payment legs of other methods;
do not publish this version before it is live.

### Added

- `payments.createSplitPayment(request, idempotencyKey)` (`POST /payments/split`)
  with the `SplitPaymentRequest` builder: `addCardLeg(cardToken, amount,
  { force3D, installment, installmentQuoteToken })` and
  `addMethodLeg(paymentMethod, providerCode, amount, fields)` (the
  `direct/payment` block; `providerCode` required). Checked before sending:
  known fields only, 1–5 legs, integer amounts adding up to `totalAmount`, one
  leg per provider and per card, card fields only on card legs, `noteCount` (no
  schedule) on a promissory-note leg, `callbackUrl` with a 3D Secure leg, an
  installment quote from 2 installments, `Idempotency-Key` of at most 200
  characters.
- Continuing a split payment after a step is the same call with the same
  request and key. The answer carries `steps`, `pendingStep` and `expiresAt`.
  While the payment runs the gateway answers HTTP 400 with the split status as
  `code`; `createSplitPayment()` returns that answer instead of throwing
  (`SPLIT_PAYMENT_IN_PROGRESS_STATUSES`). A failed split payment still throws
  `ValidationError`.
- `payments.getSplitPayment(id)`, `payments.listSplitPayments(filters)` (list
  filters sent as repeated parameters), `payments.refundSplitPayment(id, amount,
  reason, idempotencyKey)`.
- `payments.list({ includeLegs: true })`; rows carry `split` (`PaymentSplitRef`).
- `PaymentMethodInfo` and `PaymentMethodProvider` typings: `splitEligible`,
  `splitBehavior`.
- `SplitBehavior`, `SplitPaymentStatus`, `SplitLegStatus`, `SplitStepKind`,
  `SplitPendingStep`, `SplitLegRefundState`, `SplitRefundStatus`,
  `SplitRefundLegStatus`, `PaymentSplitRole`, `SplitReconciliationReason`,
  `SplitPaymentEvents`, `SPLIT_LEG_EVENTS_SUBSCRIPTION`, `SPLIT_PAYMENT_FIELDS`,
  `SPLIT_PAYMENT_LEG_FIELDS`, `SPLIT_MAX_LEGS`.
- Error code sets `SplitPayErrorCode` (`split_pay.validation.*`,
  `split_pay.step.*`, `split_pay.continuation.unavailable`,
  `split_pay.checkout.order_not_open`, `split_pay.refund.*`) and
  `CheckoutFormErrorCode` (`payment.provider.disabled_in_form`,
  `payment.method.selection_attempts_exhausted`, `payment.checkout.order_locked`).
- Sample `02-payments/split-payment.js`.
- 3D Secure display of the Checkout Form split payment (set in the panel, Form
  Settings → 3D Secure → 3D Secure display): `ThreeDsDisplay` (`INLINE`,
  `REDIRECT`). Typings `SplitPaymentResult.threeDsDisplay` and
  `SplitPaymentResult.completion` (`SplitPaymentCompletion`) for the form and
  continuation page answers; absent on `POST /payments/split`.
- Typing `SplitPaymentResult.paymentId`: the main (checkout) payment's
  `paymentId` in the form answers (`form/split/init`, `form/split/status`) and
  the continuation page answers; absent on `POST /payments/split`.
- The result posted to your `callbackUrl` when a split payment concludes on the
  hosted continuation page: `SplitCompletionOutcome` (`success`, `failure`,
  `pending`) and the `SplitMerchantCallbackFields` typing (same fields and
  signature as the single-card 3D Secure return).
- `SplitPayErrorCode`: `RESUME_UNAVAILABLE` (`split_pay.resume.unavailable`,
  `details.reason` `SplitResumeUnavailableReason`), `RESUME_ALREADY_OPENED`,
  `RESUME_PROOF_INVALID`, `RESUME_NOT_CONFIGURED`,
  `THREE_DS_RESTART_EXHAUSTED` (`split_pay.three_ds.restart_exhausted`),
  `THREE_DS_RESTART_EXPIRED` (`split_pay.three_ds.restart_expired`, HTTP 410:
  the card's 3D Secure session is closed or has expired, the buyer is asked to
  enter the card again; `details.reason` `SplitThreeDsRestartExpiredReason`).
- `SplitPayErrorCode.INSURANCE_REQUIRES_CARD_LEG`
  (`split_pay.insurance.requires_card_leg`, HTTP 422): insurance is selected
  in the Checkout Form but the split payment has no card leg. The premium is
  collected from a card leg, and card legs of an insured split payment are
  single-payment (no installments).

### Changed

- Faturana Yansıt examples and the sample send the `providerCode` your buyer
  picked. `providerSelectionMode` is documented as the API behaviour; in the
  Checkout Form the buyer always picks the provider.
- `listPaymentMethods()` documents the order (your form settings) and that a
  provider turned off only in the checkout form stays in the list.
- README: parçalı ödeme örnekleri (split payment examples): multiple cards,
  multiple payment methods (several cards with a wallet and Faturana Yansıt),
  reading the steps, completing the pending step (action confirm) and handling
  `split_pay.*` errors, with links to the docs pages.

## 0.18.0

Additive: no export, method or field was removed.

### Added

- **Insurance leads** for the types sold by request only (no quote, premium,
  order or policy): `insurance.createLead(request, idempotencyKey)` (HTTP 201,
  key required), `listLeads({ limit, cursor, insuranceType, status })` /
  `iterateLeads()`, `getLead(leadId)`. Types `InsuranceLeadRequest`,
  `InsuranceLead`, `InsuranceLeadFilters`; `InsuranceLeadStatus` (`PENDING`,
  `SUBMITTED`, `UNKNOWN`, `FAILED`); `INSURANCE_LEAD_FIELDS`;
  `INSURANCE_FILTERS.listLeads`. The lead `note` is sent as given, at most 1000
  characters.
- `InsuranceEvents.LEAD_SUBMITTED` (`insurance.lead.submitted`, also in
  `INSURANCE_EVENT_TYPES`) with its `data` type `InsuranceLeadWebhookData`
  (`InsuranceWebhookLead`). `InsuranceWebhookData.eventType` is the order
  events only (`InsuranceOrderEventType`).
- `insurance.getPolicyReceipt(policyId)` and
  `insurance.getPolicyCertificate(policyId)`: the provider's receipt and
  certificate PDF of a policy, for products that issue them.
- `createQuote()` accepts the type objects `pet` (`PET_HEALTH`), `residence`
  (`FOREIGN_RESIDENT_HEALTH`) and `abroadStay` (`ABROAD_STAY_HEALTH`).

## 0.17.0

Additive: no export, method or field was removed.

### Added

- **Insurance sold without a basket item.** `insurance.listProducts({ currency })`
  without `paymentIntentId` lists the insurance types sold on their own
  (`basketItemIds` empty), and `insurance.createQuote()` with neither
  `paymentIntentId` nor `context` prices one; the insured value is in the type
  object. Both basket sources together is still a `ConfigurationError`.
- **Insurance company of a quote option.** `InsuranceQuoteOption.underwriter`
  (`InsuranceUnderwriter`: `code`, `name`, `logoUrl`, `disclosureText`), apart
  from `provider`; `underwriterName` stays. `InsuranceQuoteSet.excludedOptions`
  (`InsuranceExcludedQuoteOption[]`: `underwriter`, `provider`, `errorCode`,
  `errors[{ field, reason }]`) lists the companies the request could not be
  priced with. Types `InsuranceFieldStage` and `InsuranceFieldRequirement`
  describe the `requiredAt` / `requiredBy` keys of `InsuranceProduct.fields`.
- `createQuote()` accepts every type object of the gateway: `stay`, `device`,
  `product`, `vehicle`, `trip`, `rental`, `instrument`, `event`, `accident`,
  `procedure` next to `tickets` (`INSURANCE_QUOTE_FIELDS`). They were refused
  before sending until now.
- `InsuranceItemCategory`: `PET`, `MICROMOBILITY`, `MUSICAL_INSTRUMENT`,
  `SHIPMENT`, `EDUCATION`.
- `BasketItemInsuranceContext`: `vehicleUsageCode`, `seatCount` (VEHICLE),
  `procedureCoverCode`, `procedureDate`, `facilityName` (HEALTH), `petSpecies`,
  `petBreedCode` (PET), `areaSqm`, `constructionYear`, `dwellingTypeCode` (HOME),
  `originCityCode`, `destinationCityCode`, `departureDate` (SHIPMENT);
  `coverageStartDate` also for EVENT and MICROMOBILITY, `categoryCode`, `brand`,
  `model` also for MUSICAL_INSTRUMENT, `startDate`, `endDate`,
  `destinationCountryCodes` also for EDUCATION.
- `InsuranceReferenceKind`: `VEHICLE_USAGE`, `LIABILITY_LIMIT`, `OCCUPATION`,
  `PET_BREED` (`parentCode` `CAT` | `DOG`), `DWELLING_TYPE`, `DWELLING_FLOOR`,
  `BANK`, `BANK_BRANCH` (`parentCode` the bank), `FINANCE_INSTITUTION`,
  `MEDICAL_PROCEDURE_COVER`.

### Changed

- `InsuranceProductFilters.paymentIntentId` is optional.

## 0.16.0

### Added

- **Insurance** (`client.insurance`) — `/api/v1/insurance` (product
  INSURANCE_SERVICE). Every call is signed.
  - `listProducts({ currency, paymentIntentId })` and
    `searchProducts({ currency, context: { items } })` — insurance types offered
    for a payment's basket or for the items before the payment
  - `listReferenceValues(kind, filters)` / `iterateReferenceValues()` — Lunixi
    reference codes (`InsuranceReferenceKind`)
  - `createQuote(request, idempotencyKey?)` (HTTP 201), `getQuote(quoteId)`
  - `createOrder(request, idempotencyKey)` (HTTP 201), `listOrders()` /
    `iterateOrders()`, `getOrder(orderId)`
  - `bindPayment(orderId, paymentIntentId, idempotencyKey?)`,
    `confirmPayment(orderId, payment, idempotencyKey)`,
    `issuePolicy(orderId, idempotencyKey)`, `cancelOrder(orderId, idempotencyKey)`,
    `refundPremium(orderId, { externalRefund? }, idempotencyKey)`
  - `getPolicyDocument(policyId)` — the policy PDF
  - `getReconciliationSummary(filters)`, `listReconciliationOrders(filters)` /
    `iterateReconciliationOrders()`, `exportReconciliation(filters)` — the CSV
    with `truncated` / `nextCursor` for files over 20000 orders
  - `InsuranceClient.consentFromQuote(option, acceptedAt)` and
    `InsuranceClient.premiumBasketItem(order, { name, category1 })` — the order
    consent and the VIRTUAL premium basket item (`id` = orderId, `price` =
    premium) of an order whose premium you collect.
- Request fields and filters are checked before sending: an unknown field, a
  quote with both or neither of `paymentIntentId` and `context.items`, a
  missing or malformed `Idempotency-Key` where it is required, a non-integer
  amount or an unknown reference kind is a `ConfigurationError`. The insurance
  type's own fields are sent as given; the gateway reports their errors (422
  `insurance.validation.invalid`).
- Value sets `InsurancePremiumCollectedBy`, `InsuranceQuoteStatus`,
  `InsuranceOrderStatus`, `InsuranceCollectionStatus`, `InsurancePolicyStatus`,
  `InsuranceRefundStatus`, `InsuranceDocumentStatus`, `InsurancePaymentMode`,
  `InsuranceOrderSurface`, `InsuranceReferenceKind`; webhook event types
  `InsuranceEvents`, `INSURANCE_EVENT_TYPES`, `INSURANCE_EVENT_PATTERN` and the
  `InsuranceWebhookData` type; `INSURANCE_QUOTE_FIELDS`, `INSURANCE_FILTERS`.
- Samples in `samples/10-insurance`.

## 0.15.0

Sanctions screening (`/api/v1/sanction/*`, product SANCTION_SERVICE,
permission `sanction:view_results`). Calls carry the access token of your API
key; no per-request signature.

### Added

- `client.sanction` (`SanctionClient`): `screenName`, `screenWallet`,
  `screenAccount`, `screenTransaction`, `screenPublicProcurementBan`,
  `screenAdverseMedia`, `evaluateBehavioralAlert`, `listScreeningHistory`,
  `registerMonitoring` (`profile` is sent as `profileJson`),
  `listMonitoringAlerts`, `listMonitoredEntities`, `listMonitoringMatches`,
  `getDatasetFreshness`, `searchEntities`, `getEntityProfile`
  (`screeningRequestId`), `getEntityGraph`, `getIndirectExposure` and
  `getOwnershipAggregation` (`entityIds` of a merged match),
  `listBlacklistEntries`; every list with an `iterate…`. Lists return
  `{ items, nextCursor, hasMore, totalCount, raw }`.
- `SANCTION_ROUTES`, the single source of the sanction routes, body and query
  fields (the PHP SDK and the Postman test read it). Bodies are checked before
  sending: unknown field, missing required field, no party and no account on a
  transaction, none of `entityName` / `tckn` / `vkn` on a procurement-ban
  screening, an unknown nested field, a risk domain, mode or subject type
  outside its set → `ConfigurationError` (the gateway forwards the body to the
  sanction service, which would drop an unknown field without an error).
- `isClearScreening(result)`: true only with no match or hit and, where the
  answer reports coverage, `coverageStatus: 'COMPLETE'`. `PARTIAL`, `DEGRADED`,
  a `null` coverage (replay of a screening made before list publications),
  `isSanctioned`, `matched`, `caseRequired` or a blocking `decision` is never
  clear.
- A screening that cannot run (no list publication, `503`) throws
  `ServiceUnavailableError`; a 2xx screening answer whose `status` is not
  `success` throws `ApiError`. Neither comes back as an empty result.
- `SanctionRiskDomain`, `SanctionScreenMode`, `SanctionWalletScreenMode`,
  `SanctionSubjectType`, `SanctionCoverageStatus`, `SanctionHitType`; typings
  for the name, wallet (`publicationHits` apart from your own `hits`), account,
  transaction and procurement-ban (`searchedLists`, `uncoveredSources`) results,
  merged matches (`lists`, `riskDomains`, `sourceListName`) and the
  publication evidence (`publicationId`, `publicationRevision`,
  `coverageStatus`, `evidenceRef`).

Not in the SDK: the screening report PDF (panel session only), adding deny-list
entries, analyst decisions and case assignment (permissions an API key does not
carry), list-source syncs.

## 0.14.0

Bank transfers and currency exchange (`/api/v1/bank-connect`, product
BANK_CONNECT, scope `bank-connect:transfer`). The API key must have an IP
allowlist; calls from an unlisted IP are refused by the gateway.

### Added

- `client.bankConnect.transfers` (`BankTransferClient`): `listPurposes(connectionId)`,
  `create(request, idempotencyKey?)`, `list(filters)` / `iterate(filters)`,
  `get(transferId)`. A transfer created with an API key is `SUBMITTED` at once
  (no e-mail code) and queued for the bank.
- `client.bankConnect.fx` (`BankFxClient`): `listRates(connectionId)`,
  `createQuote(request)`, `createOrder(request, idempotencyKey?)`,
  `listOrders(filters)` / `iterateOrders(filters)`, `getOrder(orderId)`.
- `Idempotency-Key` of `transfers.create()` and `fx.createOrder()`: a UUID v4
  is generated when you do not pass one; a key you pass is checked (8–200
  printable ASCII). A network error or a 5xx is retried with the same key.
- Bodies and filters are checked before sending against `BANK_TRANSFER_ROUTES`,
  the single source of routes, body fields, query fields and the
  Idempotency-Key rule (unknown field, missing field, non-integer amount,
  both or neither quote amount → `ConfigurationError`).
- `BankTransferStatus`, `BankTransferRail`, `BankTransferInitiatedVia`,
  `BankFxOrderStatus`, `BankFxRequestedSide`, `BankTransferEvents`
  (`bank_transfer.created|completed|failed|returned`),
  `BANK_TRANSFER_EVENT_PATTERN`, `BANK_TRANSFER_EVENT_TYPES`; typings
  `BankTransfer`, `BankFxQuote`, `BankFxOrder`, `BankTransferWebhookData` …
- `BankCapability.OUTGOING_TRANSFER`, `BankCapability.FX_EXCHANGE`.
- Read typings: `BankConnection.capabilities`, `BankAccount.productCode`,
  `displayName`, `accountType`; `BankBalance.availableWithoutOverdraftMinor`,
  `overdraftAvailableMinor`; `BankTransaction.isReversal`,
  `reversalOfTransactionId`, `counterpartyBankCode`, `counterpartyBankName`.

### Fixed

- `index.d.ts`: the `ProviderNoneEligibleDetails` interface was not closed,
  which made the typings file fail to parse.

## 0.13.0

Senetle Ödeme (promissory-note payment, `paymentMethod: PROMISSORY_NOTE`).
Requires the gateway release that accepts the `promissoryNote` block; do not
publish this version before it is live.

### Added

- `DirectMethodPaymentRequest.withMethodFields(PaymentMethod.PROMISSORY_NOTE, …)`
  sends the `promissoryNote` block (debtor and guarantor fields from
  `inputFields`). The plan: `withPromissoryNoteSchedule([{ amount, dueDate }])` or
  `withPromissoryNoteCount(count)`, never both. Checked before sending: integer
  minor-unit amounts adding up to `amount`, `YYYY-MM-DD` calendar dates in
  ascending order, at most 24 rows, note count 1–24.
- `CreateIntentRequest.withPromissoryNoteSchedule(schedule)`: the plan shown on
  the hosted form. `createIntent()` checks a raw `promissoryNote` the same way.
- `payments.getPromissoryNotes(paymentId)`,
  `payments.cancelPromissoryNotes(paymentId, serialNumbers?, idempotencyKey?)`,
  `payments.downloadPromissoryNoteDocument(paymentId, locale?)` (PDF bytes).
- `client.reference` (`ReferenceClient`): `listProvinces()`,
  `listDistricts(provinceCode)`, `listNeighborhoods(districtCode)`.
- `PromissoryNoteStatus`, `PromissoryNoteDocumentType`,
  `PromissoryNoteCancelResult`, `PromissoryNoteCancelErrorCode` (Lunixi codes of
  `cancelResults[].errorCode`), `PromissoryNoteDocumentLocale`,
  `PromissoryNoteEvents`, `PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS`.
- `MethodInputFieldType`: `VKN`, `ADDRESS`, `GROUP`. `MethodInputField` typings:
  `requiredWhen`, `itemFields`, `minItems`, `maxItems`.
- `ApiClient.request()` option `accept` (Accept header of a binary request).
- Sample `02-payments/promissory-note-payment.js`.

### Changed

- Method block and confirm `fields` values may be an object of scalars
  (`ADDRESS`, at most 16 fields) or a list of at most 10 objects (`GROUP`), as
  the gateway accepts them. Previously only scalars passed the local check.
- `DIRECT_METHOD_PAYMENT_FIELDS` includes `promissoryNote`.

## 0.12.0

### Added

- `ProviderSelectionMode` (`BUYER`, `PLATFORM`) and the `providerSelectionMode`
  field of each method in `payments.listPaymentMethods()` (typings:
  `PaymentMethodInfo.providerSelectionMode`). `BUYER`: the buyer picks the
  brand; with more than one provider `providerCode` is required. `PLATFORM`: do
  not ask the buyer and leave `providerCode` out; the platform picks a connected
  provider before any money moves.
- `payments.listPaymentMethods({ paymentMethod })` sends
  `GET /api/v1/payments/methods?paymentMethod=<code>` and lists that method only
  (`{ methods: [] }` when it is not open; `QR` is sent as `QR_CODE`). A code that
  is not upper case throws `ConfigurationError` before sending; an unknown code
  is a 400 `payment.method.unknown`. An unknown option key throws
  `ConfigurationError`. Without options the call is unchanged.
- 422 `payment.provider.none_eligible` (`ApiError`) on `directMethodPayment()`:
  a `PLATFORM` method without `providerCode` and no connected provider could take
  the payment; nothing was charged. Typings: `ProviderNoneEligibleDetails`.

### Changed

- `ProviderSelection.OPTIONAL` also covers a `PLATFORM` method with more than
  one provider connected. The value set (`ROUTED`, `OPTIONAL`, `REQUIRED`) is
  unchanged, and `providerSelection === 'REQUIRED'` still tells when
  `providerCode` must be sent.

## 0.11.0

### Removed (breaking)

The gateway no longer has the `POST /api/v1/payments/direct/2d` and
`/direct/3d` endpoints. A card is charged from the server only through
`POST /api/v1/payments/direct/payment` with `paymentMethod: CARD`
(`force3D: true` for 3D Secure).

- `payments.chargeCard()`, `payments.chargeCard2d()` and `payments.chargeCard3d()`
  were removed.
- `DirectPaymentRequest` was removed (class, export and typings).
- The hosted checkout (`createIntent()`), `createMarketplaceIntent()`, `capture()`,
  `refund()` and `void()` are unchanged.

### Migration

```js
// before
await lunixi.payments.chargeCard3d(
  new DirectPaymentRequest(amount, 'TRY', orderId, card, buyer, billingAddress, basketItems)
    .withInstallment(3, quoteToken)
    .withCallbackUrl(callbackUrl),
  idempotencyKey,
);

// after
await lunixi.payments.directMethodPayment(
  new DirectMethodPaymentRequest(amount, 'TRY', orderId)
    .withCard(card)                 // new card, or { cardUserKey, cardToken } for a stored card
    .withForce3D(true)              // leave out for chargeCard2d
    .withInstallment(3, quoteToken)
    .withCallbackUrl(callbackUrl)
    .withBuyer(buyer)
    .withBillingAddress(billingAddress)
    .withBasketItems(basketItems),
  idempotencyKey,
);
```

- The response is the `direct/payment` envelope: `data.paymentId`, `data.status`,
  `data.paymentMethod` and, for 3D Secure, `data.action` with `type: REDIRECT`
  (HTTP 202); send the buyer to `data.action.redirect.url`. A declined payment is
  HTTP 400 (`ValidationError`).
- `withPreauth`, `withDescription`, `withCustomerId`, `withPaymentChannel`,
  `withPaymentGroup`, `withMetadata` keep their names. `withCardUserKey` has no
  counterpart: put `cardUserKey` in the card (`CardDetails`).
- Samples: `02-payments/direct-2d-payment.js` and `direct-3d-payment.js` were
  removed (see `direct-method-card-payment.js`); `03-cards/charge-stored-card-2d.js`,
  the Express and NestJS samples use `directMethodPayment`.

## 0.10.0

### Breaking

The gateway has one amount field: `amount`. `price` and `paidPrice` were removed
from the intent, marketplace, direct 2D/3D and `direct/payment` bodies; a body that
still sends them is answered with 400 `payment.amount.field_removed`. Use this
version together with that gateway release: an older SDK sending `paidPrice` gets
the same 400.

- `DirectPaymentRequest(amount, currency, orderId, card, buyer, billingAddress, basketItems)`:
  the first argument is now sent as `amount` (was `paidPrice`). `withPrice()` was
  removed.
- `DirectMethodPaymentRequest(amount, currency, orderId)`: the first argument is
  now sent as `amount` (was `paidPrice`, with `price` copied from it).
  `withPrice()` was removed.
- `CreateIntentRequest`: `withPrice()`, `withPaidPrice()` and `withInstallment()`
  were removed. The intent has no installment field (the gateway answers it with
  400); the buyer picks the installment on the hosted form.
- `CreateIntentRequest` and `DirectPaymentRequest` now check `amount` like
  `DirectMethodPaymentRequest`: an integer of at least 1 minor unit, otherwise
  `ConfigurationError`.
- `DIRECT_METHOD_PAYMENT_FIELDS` lists `amount` instead of `price` and `paidPrice`.
- A raw body with `price` or `paidPrice` given to `createIntent()`,
  `createMarketplaceIntent()`, `chargeCard()` / `chargeCard2d()` / `chargeCard3d()`
  or `directMethodPayment()` throws `ConfigurationError` before sending. A raw
  direct card body must carry `amount`.

### Added

- `DirectPaymentRequest.withInstallment(count, quoteToken)`: the quote token from
  `payments.installmentOptions()` binds the installment charge (`installmentQuoteToken`);
  the system adds the installment fee to `amount`.
- `REMOVED_AMOUNT_FIELDS` (`['price', 'paidPrice']`).

## 0.9.0

### Added

- **Payment methods** — payments with any payment method from the merchant
  server, besides the card endpoints:
  - `payments.directMethodPayment(request, idempotencyKey)` —
    `POST /api/v1/payments/direct/payment`. `idempotencyKey` is required.
  - `payments.confirmPaymentAction(paymentId, actionId, { otp, consentAccepted, fields })`
    and `payments.resendPaymentAction(paymentId, actionId)` — the action endpoint
    (`/payments/{paymentId}/actions/{actionId}/confirm|resend`).
  - `payments.listPaymentMethods()` — `GET /api/v1/payments/methods`, with each
    provider's `inputFields` typed in `index.d.ts`.
  - `DirectMethodPaymentRequest`: `withMethodFields(method, providerCode, fields)`
    for any method other than card, `withCard(card)` with `withForce3D()` and
    `withInstallment()`, `withPreauth()`, `withCallbackUrl()` and the order fields of
    the direct 2D/3D body.
  - `PaymentMethod`, `PaymentActionType`, `ProviderSelection`,
    `MethodInputFieldType`, `DIRECT_METHOD_PAYMENT_FIELDS`,
    `PAYMENT_ACTION_CONFIRM_FIELDS`.
- Bodies are checked before sending: unknown fields, a block of another method,
  card-only fields with another method, a malformed method block, a non-boolean
  `preauth` / `force3D` and a confirm without `otp`, `consentAccepted` or `fields`
  throw `ConfigurationError`.
- Samples `02-payments/list-payment-methods.js`,
  `02-payments/mobile-billing-otp-payment.js`,
  `02-payments/direct-method-card-payment.js`.

### Unchanged

- `chargeCard2d()`, `chargeCard3d()`, `createIntent()`, `capture()` and `void()`
  keep their endpoints and behaviour.

## 0.8.0

### Added

- **Pre-authorization as a typed field** — `withPreauth(value)` on
  `CreateIntentRequest` (`payments.createIntent()` and
  `payments.createMarketplaceIntent()`) and `DirectPaymentRequest`
  (`payments.chargeCard2d()` / `chargeCard3d()`). `true` holds the amount and the
  payment becomes `AUTHORIZED`; take it with `payments.capture()` or release it
  with `payments.void()`. The value goes into the body's `preauth` field.
- Only a real boolean is accepted: `withPreauth('false')`, `withPreauth(1)` and a
  raw `chargeCard()` payload with a non-boolean `preauth` throw
  `ConfigurationError` before anything is sent.

### Upgrade note

- If you asked for a pre-authorization with
  `withMetadata({ autoCapture: false })`, switch to `withPreauth(true)` and drop
  the `autoCapture` key from your metadata. Pre-authorization through
  `metadata` is no longer documented and will stop working in a later gateway
  release.

## 0.7.0

### Added

- **Basket item insurance fields** (typings): `BasketItemFields` now types
  `insuranceCategory`, `insuranceTypes`, `insuranceEligible`,
  `insuranceValueAmount` and `insuranceContext` (`BasketItemInsuranceContext`).
  They are optional and accepted by `createIntent` (Checkout Form) only; direct
  2D/3D payments answer them with 400. `BasketItem` already sent every field it
  was given, so nothing changes at runtime.
- Value set `InsuranceItemCategory` (`TICKET`, `HOTEL`, `EVENT`, `DEVICE`,
  `ELECTRONICS`, `VEHICLE`, `TRAVEL`, `HOME`, `HEALTH`) and the
  `InsuranceItemCategoryValue` and `BasketItemType` types.

### Changed

- `BasketItemFields.itemType` is typed `'PHYSICAL' | 'VIRTUAL'` (it accepted any
  string). The gateway answers any other value with 400 on every endpoint, so
  TypeScript now reports it at compile time.

## 0.6.0

### Added

- **Bank accounts** (`client.bankConnect`) — `/api/v1/bank-connect` (product
  BANK_CONNECT): read your connected bank accounts, their balances and
  transactions. Every call is signed. The same methods as the PHP SDK's
  `$lunixi->bankConnect()`.
  - `listBanks()` / `iterateBanks()`
  - `listConnections(filters)` / `iterateConnections()`, `getConnection(id)`
  - `listAccounts(filters)` / `iterateAccounts()`, `getAccount(id)` — each
    account carries `freshness`
  - `listBalances(filters)` / `iterateBalances()`
  - `listTransactions(filters)` / `iterateTransactions()`, `getTransaction(id)`
    — newest recorded first; `bookedFrom` / `bookedTo` at most 92 days apart
  - `requestSync(accountId)` — HTTP 202 (`QUEUED` or `SCHEDULED`); a 429
    `RATE_LIMITED` is a `RateLimitError` with `retryAfter`
  - Lists return `{ items, hasMore, nextCursor }`. Filters are checked before
    sending (unknown filter, value outside its set, limit 1–100, at most 100
    account ids, integer amounts, the 92-day window): a `ConfigurationError`.
- Value sets `BankConnectionStatus`, `BankAccountStatus`,
  `BankTransactionDirection`, `BankTransactionType`, `BankAvailability`,
  `BankCapability`, `BankSyncStatus`, and `BANK_CONNECT_FILTERS`.
- **`bank_account.transaction.received`** webhook: `BankConnectEvents`,
  `BANK_CONNECT_EVENT_TYPES`, `BANK_CONNECT_EVENT_PATTERN` and the
  `BankAccountTransactionReceivedData` typing of the event `data`.
- Samples `samples/09-bank-accounts/`.

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
