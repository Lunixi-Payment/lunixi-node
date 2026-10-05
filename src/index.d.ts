export interface LunixiClientOptions {
  baseUrl: string;
  keyId: string;
  privateKey: string;
  authTokenPath?: string;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
  fetch?: typeof fetch;
  tokenStore?: TokenStore;
}

export interface TokenStore {
  get(): string | null;
  set(token: string, ttlSeconds: number): void;
  clear(): void;
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export interface RequestOptions {
  /** Adds the per-request Ed25519 signature to the bearer token. */
  stepUp?: boolean;
  /** Return `{ contentType, data: Buffer }` for a 2xx response instead of parsing JSON. */
  binary?: boolean;
  idempotencyKey?: string | null;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export interface BinaryResponse {
  contentType: string | null;
  data: Buffer;
}

export type JsonObject = Record<string, unknown>;

export class LunixiClient {
  constructor(options: LunixiClientOptions);
  readonly payments: PaymentClient;
  readonly paymentLinks: PaymentLinkClient;
  readonly fraud: FraudClient;
  readonly wallet: WalletClient;
  readonly tokens: TokenManager;
  readonly api: ApiClient;
  static generateKeyPair(): KeyPair;
  publicKeyPem(): string;
}

export class Configuration {
  constructor(options: LunixiClientOptions);
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly authTokenPath: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly userAgent: string;
}

export class ApiClient {
  request(method: string, path: string, body?: JsonObject | JsonObject[] | null, options?: RequestOptions & { binary?: false }): Promise<JsonObject>;
  request(method: string, path: string, body: JsonObject | JsonObject[] | null, options: RequestOptions & { binary: true }): Promise<BinaryResponse>;
}

export class Ed25519Signer {
  constructor(privateKey: string);
  sign(message: string): string;
  publicKeyPem(): string;
  static generateKeyPair(): KeyPair;
}

export class TokenManager {
  getToken(): Promise<string>;
  invalidate(): void;
}

export class InMemoryTokenStore implements TokenStore {
  get(): string | null;
  set(token: string, ttlSeconds: number): void;
  clear(): void;
}

export interface CardDetailsFields {
  cardHolderName?: string;
  cardNumber?: string;
  expireMonth?: string;
  expireYear?: string;
  cvcNumber?: string;
  cardToken?: string;
  cardUserKey?: string;
  publicCardStorageToken?: string;
  cardSave?: boolean;
  [key: string]: unknown;
}

export interface BuyerFields {
  name?: string;
  surname?: string;
  identityNumber?: string;
  email?: string;
  gsmNumber?: string;
  city?: string;
  country?: string;
  zipCode?: string;
  ip?: string;
  [key: string]: unknown;
}

export interface AddressFields {
  address?: string;
  zipCode?: string;
  contactName?: string;
  city?: string;
  country?: string;
  [key: string]: unknown;
}

export interface BasketItemFields {
  id?: string;
  price?: number;
  name?: string;
  category1?: string;
  category2?: string;
  itemType?: 'PHYSICAL' | 'VIRTUAL' | string;
  [key: string]: unknown;
}

export class CardDetails {
  constructor(fields?: CardDetailsFields);
  toJSON(): CardDetailsFields;
}

export class Buyer {
  constructor(fields?: BuyerFields);
  toJSON(): BuyerFields;
}

export class Address {
  constructor(fields?: AddressFields);
  toJSON(): AddressFields;
}

export class BasketItem {
  static readonly TYPE_PHYSICAL: 'PHYSICAL';
  static readonly TYPE_VIRTUAL: 'VIRTUAL';
  constructor(fields?: BasketItemFields);
  toJSON(): BasketItemFields;
}

export class CreateIntentRequest {
  constructor(amount: number, currency: string, orderId: string);
  withPrice(value: number): this;
  withPaidPrice(value: number): this;
  withInstallment(value: number): this;
  withCallbackUrl(value: string): this;
  withDescription(value: string): this;
  withCustomerId(value: string): this;
  withCardUserKey(value: string): this;
  withMethod(value: string): this;
  withPaymentMethod(value: string): this;
  withWalletProvider(value: string): this;
  withForce3D(value: boolean): this;
  withSettings(value: JsonObject): this;
  withPaymentChannel(value: string): this;
  withPaymentGroup(value: string): this;
  withBuyer(value: Buyer | BuyerFields): this;
  withBillingAddress(value: Address | AddressFields): this;
  withShippingAddress(value: Address | AddressFields): this;
  withBasketItems(value: Array<BasketItem | BasketItemFields>): this;
  withMetadata(value: JsonObject): this;
  toJSON(): JsonObject;
}

export class DirectPaymentRequest {
  constructor(
    paidPrice: number,
    currency: string,
    orderId: string,
    card: CardDetails | CardDetailsFields,
    buyer: Buyer | BuyerFields,
    billingAddress: Address | AddressFields,
    basketItems: Array<BasketItem | BasketItemFields>,
  );
  withPrice(value: number): this;
  withInstallment(value: number): this;
  withCallbackUrl(value: string): this;
  withDescription(value: string): this;
  withCustomerId(value: string): this;
  withCardUserKey(value: string): this;
  withPaymentChannel(value: string): this;
  withPaymentGroup(value: string): this;
  withMetadata(value: JsonObject): this;
  toJSON(): JsonObject;
}

export class InstallmentOptionsRequest {
  constructor(amount: number, currency: string);
  withBinOrPan(value: string): this;
  withInstallment(value: number): this;
  withCardBrand(value: string): this;
  toJSON(): JsonObject;
}

export class StoreCardRequest {
  constructor(card: CardDetails | CardDetailsFields, cardUserKey: string, callbackUrl: string);
  withCurrency(value: string): this;
  toJSON(): JsonObject;
}

export class PaymentClient {
  createIntent(request: CreateIntentRequest | JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  createMarketplaceIntent(request: JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  capture(intentId: string, amount?: number | null, idempotencyKey?: string | null): Promise<JsonObject>;
  refund(intentId: string, amount?: number | null, reason?: string | null, idempotencyKey?: string | null): Promise<JsonObject>;
  void(intentId: string, idempotencyKey?: string | null): Promise<JsonObject>;
  chargeCard(payload: DirectPaymentRequest | JsonObject, threeDS?: boolean, idempotencyKey?: string | null): Promise<JsonObject>;
  chargeCard2d(request: DirectPaymentRequest | JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  chargeCard3d(request: DirectPaymentRequest | JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  binInfo(binOrPan: string): Promise<JsonObject>;
  installmentOptions(request: InstallmentOptionsRequest | JsonObject): Promise<JsonObject>;
  cardTaxonomy(): Promise<JsonObject>;
  storeCard(request: StoreCardRequest | JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  listStoredCards(cardUserKey: string): Promise<JsonObject>;
  getStoredCard(storedCardToken: string): Promise<JsonObject>;
  deactivateStoredCard(storedCardToken: string, idempotencyKey?: string | null): Promise<JsonObject>;
  get(intentId: string): Promise<JsonObject>;
  list(filters?: JsonObject): Promise<JsonObject>;
  failoverRecoveryAnalytics(filters?: JsonObject): Promise<JsonObject>;
  providerCredentialAnalytics(credentialId: string, filters?: JsonObject): Promise<JsonObject>;
}

// ───────────────────────────── Payment links ─────────────────────────────

export const PaymentLinkUsage: { readonly SINGLE_USE: 'SINGLE_USE'; readonly MULTI_USE: 'MULTI_USE' };
export type PaymentLinkUsageValue = (typeof PaymentLinkUsage)[keyof typeof PaymentLinkUsage];

export const PaymentLinkAmountMode: { readonly FIXED: 'FIXED'; readonly OPEN: 'OPEN'; readonly ITEMIZED: 'ITEMIZED' };
export type PaymentLinkAmountModeValue = (typeof PaymentLinkAmountMode)[keyof typeof PaymentLinkAmountMode];

export const PaymentLinkState: {
  readonly ACTIVE: 'ACTIVE';
  readonly PAUSED: 'PAUSED';
  readonly COMPLETED: 'COMPLETED';
  readonly EXPIRED: 'EXPIRED';
  readonly DEACTIVATED: 'DEACTIVATED';
  readonly TAKEN_DOWN: 'TAKEN_DOWN';
};
export type PaymentLinkStateValue = (typeof PaymentLinkState)[keyof typeof PaymentLinkState];

export const PaymentLinkAttemptState: {
  readonly OPEN: 'OPEN';
  readonly BOUND: 'BOUND';
  readonly SUCCEEDED: 'SUCCEEDED';
  readonly FAILED: 'FAILED';
  readonly EXPIRED: 'EXPIRED';
  readonly ABANDONED: 'ABANDONED';
  readonly NEEDS_REVIEW: 'NEEDS_REVIEW';
};
export type PaymentLinkAttemptStateValue = (typeof PaymentLinkAttemptState)[keyof typeof PaymentLinkAttemptState];

export const PaymentLinkEnvironment: { readonly TEST: 'TEST'; readonly LIVE: 'LIVE' };
export type PaymentLinkEnvironmentValue = (typeof PaymentLinkEnvironment)[keyof typeof PaymentLinkEnvironment];

export const BuyerFieldRequirement: { readonly HIDDEN: 'HIDDEN'; readonly OPTIONAL: 'OPTIONAL'; readonly REQUIRED: 'REQUIRED' };
export type BuyerFieldRequirementValue = (typeof BuyerFieldRequirement)[keyof typeof BuyerFieldRequirement];

export const CustomFieldType: {
  readonly TEXT: 'TEXT';
  readonly NUMBER: 'NUMBER';
  readonly EMAIL: 'EMAIL';
  readonly PHONE: 'PHONE';
  readonly DATE: 'DATE';
  readonly SELECT: 'SELECT';
  readonly CHECKBOX: 'CHECKBOX';
  readonly TCKN: 'TCKN';
  readonly VKN: 'VKN';
};
export type CustomFieldTypeValue = (typeof CustomFieldType)[keyof typeof CustomFieldType];

export const PaymentLinkButtonLabel: { readonly PAY: 'PAY'; readonly DONATE: 'DONATE'; readonly BUY: 'BUY'; readonly BOOK: 'BOOK' };
export type PaymentLinkButtonLabelValue = (typeof PaymentLinkButtonLabel)[keyof typeof PaymentLinkButtonLabel];

export const PaymentLinkDeliveryChannel: { readonly EMAIL: 'EMAIL'; readonly SMS: 'SMS' };
export type PaymentLinkDeliveryChannelValue = (typeof PaymentLinkDeliveryChannel)[keyof typeof PaymentLinkDeliveryChannel];

export const PaymentLinkQrFormat: { readonly SVG: 'svg'; readonly PNG: 'png' };
export type PaymentLinkQrFormatValue = (typeof PaymentLinkQrFormat)[keyof typeof PaymentLinkQrFormat];

export const PaymentLinkLocale: { readonly TR: 'tr'; readonly EN: 'en' };
export type PaymentLinkLocaleValue = (typeof PaymentLinkLocale)[keyof typeof PaymentLinkLocale];

/** Declarable link image types. The stored bytes must match the declared type; SVG is never accepted. */
export const PaymentLinkImageContentType: { readonly PNG: 'image/png'; readonly JPEG: 'image/jpeg'; readonly WEBP: 'image/webp' };
export type PaymentLinkImageContentTypeValue = (typeof PaymentLinkImageContentType)[keyof typeof PaymentLinkImageContentType];

/** Every definition field of a payment link, in REST (camelCase) spelling. */
export const PAYMENT_LINK_SPEC_FIELDS: readonly (keyof PaymentLinkSpecFields)[];

export interface PaymentLinkItemFields {
  /** Permanent identity of the line; generated (`it_…`) when omitted. */
  itemKey?: string;
  name: string;
  description?: string;
  /** Integer, minor units. */
  unitPriceMinor: number;
  minQuantity?: number;
  maxQuantity?: number;
  /** Units available for this line; `null` = unlimited. */
  capacity?: number | null;
  imageAssetId?: string | null;
}

export interface PaymentLinkCustomFieldFields {
  key: string;
  label: string;
  fieldType: CustomFieldTypeValue;
  required?: boolean;
  options?: string[];
  maxLength?: number;
  helpText?: string;
}

export interface PaymentLinkBuyerFields {
  name?: BuyerFieldRequirementValue;
  email?: BuyerFieldRequirementValue;
  phone?: BuyerFieldRequirementValue;
  address?: BuyerFieldRequirementValue;
  identityNumber?: BuyerFieldRequirementValue;
}

export interface PaymentLinkRecipient {
  name?: string;
  email?: string;
  /** E.164, e.g. `+905321112233`. */
  phone?: string;
}

export interface PaymentLinkPrefill {
  name?: string;
  surname?: string;
  email?: string;
  phone?: string;
  identityNumber?: string;
  address?: string;
  city?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  zipCode?: string;
}

export interface PaymentLinkVerification {
  required: boolean;
  channel?: PaymentLinkDeliveryChannelValue;
}

export interface PaymentLinkReminders {
  enabled: boolean;
  intervalHours?: number;
  maxCount?: number;
}

export interface PaymentLinkCheckoutPolicy {
  requireThreeDs?: boolean;
  paymentMethods?: string[];
}

/**
 * The definition of a payment link (REST, camelCase). Amounts are integers in
 * minor units. Times are ISO-8601 strings (a `Date` is accepted on input).
 */
export interface PaymentLinkSpecFields {
  usage: PaymentLinkUsageValue;
  amountMode: PaymentLinkAmountModeValue;
  currency: string;
  amountMinor?: number | null;
  minAmountMinor?: number | null;
  maxAmountMinor?: number | null;
  suggestedAmountsMinor?: number[];
  quantityEnabled?: boolean;
  minQuantity?: number;
  maxQuantity?: number;
  items?: PaymentLinkItemFields[];
  capacity?: number | null;
  title: string;
  description?: string;
  imageAssetId?: string | null;
  successMessage?: string;
  successRedirectUrl?: string | null;
  taxNote?: string;
  locale?: PaymentLinkLocaleValue;
  startsAt?: string | Date | null;
  expiresAt?: string | Date | null;
  eventAt?: string | Date | null;
  buttonLabelKey?: PaymentLinkButtonLabelValue | null;
  requireTermsAcceptance?: boolean;
  buyerFields?: PaymentLinkBuyerFields | null;
  customFields?: PaymentLinkCustomFieldFields[];
  recipient?: PaymentLinkRecipient | null;
  prefill?: PaymentLinkPrefill | null;
  verification?: PaymentLinkVerification | null;
  reminders?: PaymentLinkReminders | null;
  checkout?: PaymentLinkCheckoutPolicy | null;
  reference?: string;
  tags?: string[];
  branchCode?: string;
  salesChannel?: string;
  campaign?: string;
  agentCode?: string;
  merchantNotifyEmails?: string[];
  metadata?: Record<string, string> | null;
}

export interface CreatePaymentLinkBody extends PaymentLinkSpecFields {
  /** Optional; must equal the API key's environment. */
  environment?: PaymentLinkEnvironmentValue;
}

/** Update: only the keys present change; `null` clears. `usage`, `amountMode` and `currency` are fixed. */
export type PaymentLinkChanges = Partial<Omit<PaymentLinkSpecFields, 'usage' | 'amountMode' | 'currency'>>;

export class PaymentLinkItem {
  constructor(name: string, unitPriceMinor: number);
  withItemKey(value: string): this;
  withDescription(value: string): this;
  withQuantityRange(minQuantity: number, maxQuantity: number): this;
  withCapacity(value: number | null): this;
  withImageAssetId(value: string | null): this;
  toJSON(): PaymentLinkItemFields;
}

export class PaymentLinkCustomField {
  constructor(key: string, label: string, fieldType: CustomFieldTypeValue);
  withRequired(value?: boolean): this;
  withOptions(values: string[]): this;
  withMaxLength(value: number): this;
  withHelpText(value: string): this;
  toJSON(): PaymentLinkCustomFieldFields;
}

export class CreatePaymentLinkRequest {
  static fixed(usage: PaymentLinkUsageValue, amountMinor: number, currency: string, title: string): CreatePaymentLinkRequest;
  static open(
    usage: PaymentLinkUsageValue,
    currency: string,
    title: string,
    amounts: { minAmountMinor: number; maxAmountMinor?: number | null; suggestedAmountsMinor?: number[] | null },
  ): CreatePaymentLinkRequest;
  static itemized(
    usage: PaymentLinkUsageValue,
    currency: string,
    title: string,
    items: Array<PaymentLinkItem | PaymentLinkItemFields>,
  ): CreatePaymentLinkRequest;
  constructor(usage: PaymentLinkUsageValue, amountMode: PaymentLinkAmountModeValue, currency: string, title: string);
  withEnvironment(value: PaymentLinkEnvironmentValue): this;
  withAmountMinor(value: number): this;
  withMinAmountMinor(value: number): this;
  withMaxAmountMinor(value: number): this;
  withSuggestedAmountsMinor(values: number[]): this;
  withQuantity(minQuantity: number, maxQuantity: number): this;
  withItems(items: Array<PaymentLinkItem | PaymentLinkItemFields>): this;
  addItem(item: PaymentLinkItem | PaymentLinkItemFields): this;
  withCapacity(value: number | null): this;
  withDescription(value: string): this;
  withImageAssetId(value: string | null): this;
  withSuccessMessage(value: string): this;
  withSuccessRedirectUrl(value: string | null): this;
  withTaxNote(value: string): this;
  withLocale(value: PaymentLinkLocaleValue): this;
  withStartsAt(value: string | Date | null): this;
  withExpiresAt(value: string | Date | null): this;
  withEventAt(value: string | Date | null): this;
  withButtonLabelKey(value: PaymentLinkButtonLabelValue | null): this;
  withTermsAcceptanceRequired(value?: boolean): this;
  withBuyerFields(value: PaymentLinkBuyerFields | null): this;
  withCustomFields(fields: Array<PaymentLinkCustomField | PaymentLinkCustomFieldFields>): this;
  addCustomField(field: PaymentLinkCustomField | PaymentLinkCustomFieldFields): this;
  withRecipient(value: PaymentLinkRecipient | null): this;
  withPrefill(value: PaymentLinkPrefill | null): this;
  withVerification(required?: boolean, channel?: PaymentLinkDeliveryChannelValue): this;
  withReminders(intervalHours: number, maxCount: number): this;
  withCheckout(policy?: PaymentLinkCheckoutPolicy): this;
  withReference(value: string): this;
  withTags(values: string[]): this;
  withBranchCode(value: string): this;
  withSalesChannel(value: string): this;
  withCampaign(value: string): this;
  withAgentCode(value: string): this;
  withMerchantNotifyEmails(values: string[]): this;
  withMetadata(value: Record<string, string> | null): this;
  toJSON(): CreatePaymentLinkBody;
}

export interface PaymentLinkCounters {
  paidCount: number;
  collectedAmountMinor: number;
  refundedAmountMinor: number;
  soldQuantity: number;
  reservedQuantity: number;
  attemptCount: number;
}

export interface PaymentLinkAvailability {
  soldOut: boolean;
  remainingQuantity: number | null;
  /** SINGLE_USE: another buyer is paying right now. */
  inProgress: boolean;
  items: Array<{ itemKey: string; soldOut: boolean; remainingQuantity: number | null }>;
}

/** A payment link as returned by create/get/update and the actions. */
export interface PaymentLink extends Omit<PaymentLinkSpecFields, 'startsAt' | 'expiresAt' | 'eventAt' | 'locale'> {
  id: string;
  shortCode: string;
  /** `https://pay.lunixi.com/<shortCode>` — share this. */
  url: string;
  organizationId: string;
  environment: PaymentLinkEnvironmentValue;
  state: PaymentLinkStateValue;
  /** `NONE` | `PENDING` | `APPROVED` | `REJECTED`. A PENDING link cannot be paid or sent yet. */
  reviewState: string;
  version: number;
  /** Pass back as `expectedRowVersion` on update and actions. */
  rowVersion: number;
  createdBy: { type: 'USER' | 'API_KEY' | string; id: string };
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  expiredAt: string | null;
  deactivatedAt: string | null;
  takedown: { reasonCode: string; takenDownAt: string | null } | null;
  verificationLocked: boolean;
  hasActiveAttempt: boolean;
  /** Amount fields cannot be edited (payment in progress or already paid). */
  amountLocked: boolean;
  counters: PaymentLinkCounters;
  availability: PaymentLinkAvailability;
  /** `''` when no language was set on the link. */
  locale: PaymentLinkLocaleValue | '';
  startsAt: string | null;
  expiresAt: string | null;
  eventAt: string | null;
  /** Present on create: `true` when an identical earlier request with the same Idempotency-Key was returned. */
  replayed?: boolean;
}

/** A row of the link list. */
export interface PaymentLinkSummary {
  id: string;
  shortCode: string;
  url: string;
  organizationId: string;
  environment: PaymentLinkEnvironmentValue;
  state: PaymentLinkStateValue;
  reviewState: string;
  usage: PaymentLinkUsageValue;
  amountMode: PaymentLinkAmountModeValue;
  currency: string;
  amountMinor: number | null;
  title: string;
  reference: string;
  tags: string[];
  paidCount: number;
  collectedAmountMinor: number;
  expiresAt: string | null;
  createdByType: 'USER' | 'API_KEY' | string;
  createdById: string;
  createdAt: string | null;
  version: number;
  rowVersion: number;
  [key: string]: unknown;
}

export interface PaymentLinkAttempt {
  id: string;
  state: PaymentLinkAttemptStateValue;
  linkVersion: number;
  paymentId: string | null;
  amountMinor: number;
  currency: string;
  quantity: number;
  lines: Array<{ itemKey: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  customFields: Array<{ key: string; value: string }>;
  /** Canonical failure key when FAILED (e.g. `card.insufficient_funds`); never a raw bank message. */
  failureCode: string | null;
  /** `DEFINITIVE_FAILURE` | `UNKNOWN` | null. */
  outcomeCertainty: string | null;
  /** `HELD` | `CONVERTED` | `RELEASED`. */
  reservationState: string;
  createdAt: string | null;
  boundAt: string | null;
  finalizedAt: string | null;
  [key: string]: unknown;
}

export interface PaymentLinkPayment {
  attemptId: string;
  paymentId: string;
  paymentStatus: string;
  amountMinor: number;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  currency: string;
  paidAt: string | null;
  buyerEmail: string;
  receiptNumber: string | null;
  [key: string]: unknown;
}

export interface PaymentLinkDelivery {
  id: string;
  kind: string;
  channel: PaymentLinkDeliveryChannelValue;
  recipientMasked: string;
  /** `QUEUED` | `SENT` | `DELIVERED` | `FAILED`. */
  state: string;
  /** Set when FAILED, e.g. `channel_not_available`, `test_mode_recipient_not_allowed`. */
  failureReason: string | null;
  attemptId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  [key: string]: unknown;
}

export interface PaymentLinkPage<T> {
  items: T[];
  hasMore: boolean;
  /** Opaque — pass back verbatim as `cursor`. */
  nextCursor: string | null;
  /** Only when `includeTotal: true` was requested. */
  totalCount: number | null;
}

export interface PaymentLinkPageFilters {
  /** 1–100 (default 25). */
  limit?: number;
  cursor?: string;
  /** Adds `totalCount` to the page. Costs a count query. */
  includeTotal?: boolean;
}

export interface PaymentLinkListFilters extends PaymentLinkPageFilters {
  state?: PaymentLinkStateValue | PaymentLinkStateValue[];
  usage?: PaymentLinkUsageValue | PaymentLinkUsageValue[];
  amountMode?: PaymentLinkAmountModeValue | PaymentLinkAmountModeValue[];
  environment?: PaymentLinkEnvironmentValue;
  tag?: string;
  branchCode?: string;
  createdById?: string;
  /** Exact short code, or a title/reference prefix. */
  query?: string;
  /** Half-open window `[createdFrom, createdTo)`. */
  createdFrom?: string | Date;
  createdTo?: string | Date;
}

export interface PaymentLinkAttemptFilters extends PaymentLinkPageFilters {
  state?: PaymentLinkAttemptStateValue | PaymentLinkAttemptStateValue[];
}

export interface PaymentLinkActionOptions {
  /** The link's current `rowVersion`; omitted = no version check. */
  expectedRowVersion?: number;
  /** Stored in the link's audit trail. */
  reason?: string;
}

export interface SendPaymentLinkOptions {
  channel: PaymentLinkDeliveryChannelValue;
  recipientEmail?: string;
  recipientPhone?: string;
  locale?: PaymentLinkLocaleValue;
}

export interface PaymentLinkImageUploadRequest {
  /** Original file name, recorded only (1–255 characters). */
  fileName: string;
  contentType: PaymentLinkImageContentTypeValue;
  /** The file's size in bytes. Over 2 MiB is refused before anything is uploaded. */
  sizeBytes: number;
}

/** Where to PUT the image: the storage host, not the gateway. Send it no access token and no signature. */
export interface PaymentLinkImageUploadTarget {
  /** Pass to `confirmImageUpload()` once the PUT has succeeded. */
  assetId: string;
  uploadUrl: string;
  uploadMethod: 'PUT';
  /** Send exactly these headers with the PUT: the URL is signed over them. */
  uploadHeaders: Record<string, string>;
  /** ISO-8601; the upload URL stops working after this. */
  expiresAt: string | null;
}

export interface PaymentLinkImage {
  /** Use as `imageAssetId` of a link or an item. */
  assetId: string;
  /** Public URL of the published image; null when the public image host is not configured. */
  url: string | null;
  state: 'PUBLISHED';
}

export interface PaymentLinkImageContent {
  /** Original file name, recorded only (1–255 characters). */
  fileName: string;
  contentType: PaymentLinkImageContentTypeValue;
  /** The file's bytes (a Buffer is a Uint8Array); at most 2 MiB. */
  content: Uint8Array | ArrayBuffer;
}


export class PaymentLinkClient {
  create(request: CreatePaymentLinkRequest | CreatePaymentLinkBody, idempotencyKey: string): Promise<PaymentLink>;
  list(filters?: PaymentLinkListFilters): Promise<PaymentLinkPage<PaymentLinkSummary>>;
  iterate(filters?: PaymentLinkListFilters): AsyncGenerator<PaymentLinkSummary, void, void>;
  get(linkId: string): Promise<PaymentLink>;
  update(linkId: string, expectedRowVersion: number, changes: PaymentLinkChanges, idempotencyKey?: string | null): Promise<PaymentLink>;
  pause(linkId: string, options?: PaymentLinkActionOptions, idempotencyKey?: string | null): Promise<PaymentLink>;
  resume(linkId: string, options?: PaymentLinkActionOptions, idempotencyKey?: string | null): Promise<PaymentLink>;
  deactivate(linkId: string, options?: PaymentLinkActionOptions, idempotencyKey?: string | null): Promise<PaymentLink>;
  action(linkId: string, action: 'pause' | 'resume' | 'deactivate', options?: PaymentLinkActionOptions, idempotencyKey?: string | null): Promise<PaymentLink>;
  send(linkId: string, options: SendPaymentLinkOptions, idempotencyKey: string): Promise<{ delivery: PaymentLinkDelivery | null; replayed: boolean }>;
  qr(linkId: string, options?: { format?: PaymentLinkQrFormatValue; size?: number }): Promise<BinaryResponse>;
  listAttempts(linkId: string, filters?: PaymentLinkAttemptFilters): Promise<PaymentLinkPage<PaymentLinkAttempt>>;
  iterateAttempts(linkId: string, filters?: PaymentLinkAttemptFilters): AsyncGenerator<PaymentLinkAttempt, void, void>;
  listPayments(linkId: string, filters?: PaymentLinkPageFilters): Promise<PaymentLinkPage<PaymentLinkPayment>>;
  iteratePayments(linkId: string, filters?: PaymentLinkPageFilters): AsyncGenerator<PaymentLinkPayment, void, void>;
  /** Image step 1 of 3 (scope `payment-link:create`). */
  createImageUpload(image: PaymentLinkImageUploadRequest): Promise<PaymentLinkImageUploadTarget>;
  /** Image step 3 of 3: resolves only with a published image. */
  confirmImageUpload(assetId: string): Promise<PaymentLinkImage>;
  /** All three image steps; the PUT to storage carries no access token and no signature. */
  uploadImage(image: PaymentLinkImageContent): Promise<PaymentLinkImage>;
}

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: JsonObject;
  raw: JsonObject;
}

export interface WebhookVerifierOptions {
  /** Replay window in seconds (default 300). Pass null to disable the freshness check. */
  toleranceSeconds?: number | null;
}

export class WebhookVerifier {
  constructor(secret: string, options?: WebhookVerifierOptions);
  verify(rawBody: string | Buffer, headers?: Record<string, string | string[] | undefined>): WebhookEvent;
}

export class LunixiError extends Error {
  readonly cause?: unknown;
}

export class ConfigurationError extends LunixiError {}
export class SignatureError extends LunixiError {}

export class ApiError extends LunixiError {
  readonly statusCode: number;
  readonly code: string | null;
  readonly response: unknown;
  readonly requestId: string | null;
}

/** 400 — the gateway rejected the body (a value outside a closed dictionary, an unknown field). */
export class ValidationError extends ApiError {}

/** Quota numbers read from the response headers. A field is null when the gateway did not send it. */
export interface QuotaSnapshot {
  rateLimit: number | null;
  rateRemaining: number | null;
  rateReset: number | null;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  dailyReset: number | null;
}

/** 429 — quota exceeded. */
export class RateLimitError extends ApiError {
  readonly retryAfter: number | null;
  readonly quota: QuotaSnapshot | null;
}

/** 503 — the service or its quota backend is unavailable. */
export class ServiceUnavailableError extends ApiError {
  readonly retryAfter: number | null;
  readonly quota: QuotaSnapshot | null;
}

// ───────────────────────────── Fraud ─────────────────────────────

/** Channels an external caller may declare. Platform channels are not declarable. */
export type FraudChannel = 'merchant_form' | 'standalone_api';
export type FraudSurface = 'form_gate' | 'transaction' | 'withdrawal_gate' | 'settlement';
export type FraudStage =
  | 'pre_authorization'
  | 'post_authentication'
  | 'post_hoc'
  | 'async_event'
  | 'scheduled';
export type FraudOperationKind =
  | 'card_sale'
  | 'card_preauth'
  | 'w2w_transfer'
  | 'w2iban_withdrawal'
  | 'bulk_payout'
  | 'agent_cash_out'
  | 'bill_payment'
  | 'merchant_payment'
  | 'qr_payment'
  | 'card_topup'
  | 'agent_topup'
  | 'bank_transfer_topup'
  | 'outbound_transfer'
  | 'inbound_transfer';
export type FraudAuthMode = '2d' | '3d';
export type FraudProductContext =
  | 'live_session'
  | 'payment_form'
  | 'hosted_payment_form'
  | 'direct_api';
export type FraudDecisionOutcome = 'allow' | 'review' | 'block' | 'force_3d';

/**
 * Body of a decision request.
 *
 * `tenantId` is absent by design: it is stamped from the access token and a body
 * value is ignored. Engine-internal fields are not part of this surface.
 */
export interface FraudEvaluateRequest {
  /** Only `standalone` is declarable from outside; anything else is a 400. */
  integrationMode?: 'standalone';
  productContext?: FraudProductContext;
  /** Up to 180 characters. Repeat evaluations of the same ref count as one transaction for 30 days. */
  transactionRef?: string;
  channel?: FraudChannel;
  surface?: FraudSurface;
  stage?: FraudStage;
  operationKind?: FraudOperationKind;
  authModeRequested?: FraudAuthMode;
  authModeApplied?: FraudAuthMode;
  /** Letters, digits and `. _ : @ -`, up to 180 characters. */
  subMerchantRef?: string;
  subjectType?: string;
  /** Up to 180 characters. Required with `channel: 'merchant_form'`, and must equal the SDK session's subjectId. */
  subjectId?: string;
  paymentRail?: string;
  transferDirection?: string;
  merchantGroupIds?: string[];
  paymentId?: string;
  payment?: JsonObject;
  bankTransfer?: JsonObject;
  cryptoTransfer?: JsonObject;
  walletOperation?: JsonObject;
  billPayment?: JsonObject;
  loanApplication?: JsonObject;
  payout?: JsonObject;
  customer?: JsonObject;
  device?: JsonObject;
  session?: JsonObject;
  merchant?: JsonObject;
  mobileApp?: JsonObject;
  telemetry?: JsonObject;
  metadata?: JsonObject;
  identitySnapshot?: JsonObject;
  /** Signed identity artefact from the browser SDK. Sent only with `channel: 'merchant_form'`, alongside `subjectId`. */
  identityAssertion?: string;
}

export interface FraudDecision extends JsonObject {
  decision?: FraudDecisionOutcome;
  score?: number;
  traceId?: string;
  reasonCodes?: string[];
  matchedRules?: string[];
  tags?: string[];
}

export interface FraudDecisionFilters {
  paymentId?: string;
  decision?: FraudDecisionOutcome;
  integrationMode?: string;
  productContext?: string;
  limit?: number;
  /** Opaque cursor from the previous page's `nextCursor`. Do not build or modify it. */
  cursor?: string;
}

/** A cursor page. `pageInfo` is a sibling of `data` in the envelope; this flattens it. */
export interface FraudDecisionPage {
  items: FraudDecision[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number | null;
}

/** Result of recording one event. `id` is absent when the event was deduplicated. */
export interface FraudEventResult extends JsonObject {
  eventId?: string;
  id?: string;
  deduplicated?: boolean;
  matchedFlowCount?: number;
  /** Per-event validation message inside a batch result. */
  error?: string;
}

/**
 * Result of a batch call. A batch answers 200 even when some events were
 * rejected, so `failed` is the field to check — not the HTTP status.
 */
export interface FraudEventBatchResult extends JsonObject {
  total?: number;
  inserted?: number;
  deduplicated?: number;
  failed?: number;
  results?: FraudEventResult[];
}

export class FraudEventsClient {
  record(event: JsonObject, idempotencyKey?: string | null): Promise<FraudEventResult>;
  recordBatch(events: JsonObject[], idempotencyKey?: string | null): Promise<FraudEventBatchResult>;
}

export class FraudDecisionsClient {
  list(filters?: FraudDecisionFilters): Promise<FraudDecisionPage>;
  get(traceId: string): Promise<FraudDecision>;
  latestForPayment(paymentId: string): Promise<FraudDecision | null>;
  iterate(filters?: FraudDecisionFilters): AsyncGenerator<FraudDecision, void, void>;
}

export class FraudClient {
  readonly events: FraudEventsClient;
  readonly decisions: FraudDecisionsClient;
  evaluate(request: FraudEvaluateRequest): Promise<FraudDecision>;
}

/** Fraud webhook event types deliverable to a merchant endpoint. */
export const FraudEvents: {
  readonly FLOW_ASYNC_COMPLETED: 'fraud.flow.async_completed';
  readonly FLOW_ACTION_TRIGGERED: 'fraud.flow.action_triggered';
  readonly QUOTA_THRESHOLD_REACHED: 'fraud.quota.threshold_reached';
  readonly ALERT_TRIGGERED: 'fraud.alert.triggered';
  readonly SERVICE_DEGRADED: 'fraud.service.degraded';
  readonly SERVICE_RECOVERED: 'fraud.service.recovered';
  readonly REPORT_READY: 'fraud.report.ready';
};

export type FraudEventType = (typeof FraudEvents)[keyof typeof FraudEvents];
export const FRAUD_EVENT_TYPES: readonly FraudEventType[];

export const FraudDecisionValue: {
  readonly ALLOW: 'allow';
  readonly REVIEW: 'review';
  readonly BLOCK: 'block';
  readonly FORCE_3D: 'force_3d';
};

export const FRAUD_DECISION_VALUES: readonly FraudDecisionOutcome[];
export const FRAUD_EVALUATE_FIELDS: readonly (keyof FraudEvaluateRequest)[];

/** Fraud request dictionaries. */
export const fraud: {
  readonly CHANNELS: { readonly MERCHANT_FORM: 'merchant_form'; readonly STANDALONE_API: 'standalone_api' };
  readonly SURFACES: Record<string, FraudSurface>;
  readonly STAGES: Record<string, FraudStage>;
  readonly OPERATION_KINDS: Record<string, FraudOperationKind>;
  readonly AUTH_MODES: { readonly TWO_D: '2d'; readonly THREE_D: '3d' };
  readonly PRODUCT_CONTEXTS: Record<string, FraudProductContext>;
  readonly INTEGRATION_MODE_STANDALONE: 'standalone';
  readonly TRANSACTION_REF_MAX_LENGTH: 180;
  readonly SUBJECT_ID_MAX_LENGTH: 180;
  readonly SUB_MERCHANT_REF_PATTERN: RegExp;
  readonly CHANNEL_VALUES: readonly FraudChannel[];
  readonly SURFACE_VALUES: readonly FraudSurface[];
  readonly STAGE_VALUES: readonly FraudStage[];
  readonly OPERATION_KIND_VALUES: readonly FraudOperationKind[];
  readonly AUTH_MODE_VALUES: readonly FraudAuthMode[];
  readonly PRODUCT_CONTEXT_VALUES: readonly FraudProductContext[];
};

// ── Wallet — /api/v1/wallet/* (merchant server-to-server) ─────────────────────

export const WalletAccountType: { readonly PERSONAL: 'PERSONAL'; readonly BUSINESS: 'BUSINESS' };
export type WalletAccountTypeValue = (typeof WalletAccountType)[keyof typeof WalletAccountType];
export const WalletEndUserStatus: { readonly ACTIVE: 'ACTIVE'; readonly FROZEN: 'FROZEN'; readonly CLOSED: 'CLOSED' };
export type WalletEndUserStatusValue = (typeof WalletEndUserStatus)[keyof typeof WalletEndUserStatus];
export const WalletKycLevel: { readonly NONE: 'NONE'; readonly LOW: 'LOW'; readonly SUBSTANTIAL: 'SUBSTANTIAL'; readonly HIGH: 'HIGH' };
export type WalletKycLevelValue = (typeof WalletKycLevel)[keyof typeof WalletKycLevel];
export const WalletOtpChannel: { readonly EMAIL: 'EMAIL'; readonly SMS: 'SMS'; readonly PUSH: 'PUSH' };
export type WalletOtpChannelValue = (typeof WalletOtpChannel)[keyof typeof WalletOtpChannel];
export const WalletQrType: {
  readonly P2P_STATIC: 'P2P_STATIC';
  readonly P2P_DYNAMIC: 'P2P_DYNAMIC';
  readonly MERCHANT_STATIC: 'MERCHANT_STATIC';
  readonly MERCHANT_DYNAMIC: 'MERCHANT_DYNAMIC';
};
export type WalletQrTypeValue = (typeof WalletQrType)[keyof typeof WalletQrType];
export const WalletQrImageFormat: { readonly SVG: 'svg'; readonly PNG: 'png' };
export type WalletQrImageFormatValue = (typeof WalletQrImageFormat)[keyof typeof WalletQrImageFormat];
export const WalletBulkTargetType: { readonly WALLET: 'WALLET'; readonly IBAN: 'IBAN' };
export type WalletBulkTargetTypeValue = (typeof WalletBulkTargetType)[keyof typeof WalletBulkTargetType];
export const WalletCorporateAccountStatus: { readonly ACTIVE: 'ACTIVE'; readonly ARCHIVED: 'ARCHIVED' };
export type WalletCorporateAccountStatusValue = (typeof WalletCorporateAccountStatus)[keyof typeof WalletCorporateAccountStatus];

export interface WalletRoute {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly idempotencyKey: boolean;
  readonly required?: readonly string[];
  readonly optional?: readonly string[];
  readonly query?: readonly string[];
  readonly binary?: boolean;
}
/** Every route the wallet client calls, with the gateway's field and Idempotency-Key rules. */
export const WALLET_ROUTES: Readonly<Record<string, WalletRoute>>;

/** Minor units as a digit string (`"12550"` = 125.50). A safe non-negative integer number is also accepted. */
export type WalletAmount = string | number;

export interface WalletPage<T = JsonObject> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** The unwrapped `data` of the list response. */
  raw: JsonObject;
}
export interface WalletPageFilters {
  limit?: number;
  cursor?: string;
}

export interface WalletCreateEndUserRequest {
  programId: string;
  accountType: WalletAccountTypeValue;
  phone: string;
  externalCustomerId?: string;
  kycRef?: string;
  kycLevelCache?: string;
  displayName?: string;
  corporateAccountId?: string;
  defaultCurrency?: string;
}
export interface WalletEndUserFilters extends WalletPageFilters {
  programId?: string;
  accountType?: WalletAccountTypeValue;
  status?: WalletEndUserStatusValue;
  corporateAccountId?: string;
  merchantCategoryState?: 'UNSET' | 'SET';
}
export interface WalletUpdateKycLevelRequest {
  kycLevel: WalletKycLevelValue;
  /** Your KYC session id. */
  sourceRef: string;
  externalCustomerId?: string;
  programId?: string;
  reason?: string;
  effectiveAt?: string;
  expectedCurrentLevel?: WalletKycLevelValue;
}
export interface WalletLookupRequest {
  programId?: string;
  phone?: string;
  walletNo?: string;
}
export interface WalletSimulateInboundCreditRequest {
  programId: string;
  railId: string;
  amount: WalletAmount;
  currency: string;
  rawReference: string;
  senderName?: string;
  senderIban?: string;
  creditedIban?: string;
  receiptNumber?: string;
}
export interface WalletCreateCorporateAccountRequest {
  programId: string;
  code: string;
  name: string;
  ownerEndUserId: string;
  fundingCurrency?: string;
}
export interface WalletCorporateFilters extends WalletPageFilters {
  programId?: string;
  status?: WalletCorporateAccountStatusValue;
}
export interface WalletEmployeeImportRow {
  phone: string;
  displayName?: string;
  externalCustomerId?: string;
  kycRef?: string;
}
export interface WalletEmployeeOffboardRow {
  endUserId?: string;
  externalCustomerId?: string;
}
export interface WalletQuoteFeesRequest {
  programId: string;
  operationType: string;
  currency: string;
  amount: WalletAmount;
  at?: string;
}
export interface WalletW2WQuoteRequest {
  /** The end user who owns `sourceWalletAccountId`. */
  endUserId: string;
  sourceWalletAccountId: string;
  destinationWalletNo?: string;
  destinationPhone?: string;
  amount: WalletAmount;
  currency: string;
  paymentPurpose?: string;
}
export interface WalletOtpOptions {
  scheduleVersionId?: string;
  otpDestination?: string;
  otpChannel?: WalletOtpChannelValue;
  locale?: string;
}
export type WalletW2WInitiateRequest = WalletW2WQuoteRequest & WalletOtpOptions;
export interface WalletIbanQuoteRequest {
  endUserId: string;
  sourceWalletAccountId: string;
  beneficiaryName: string;
  iban: string;
  bankCode?: string;
  amount: WalletAmount;
  currency: string;
  paymentPurpose?: string;
}
export type WalletIbanInitiateRequest = WalletIbanQuoteRequest & WalletOtpOptions;
/** `operationId` is filled from the method argument. */
export interface WalletCompleteRequest {
  endUserId: string;
  integrityHash: string;
  nonce: string;
  otpCode?: string;
  trustedActionToken?: string;
  operationId?: string;
}
export interface WalletOperationFilters extends WalletPageFilters {
  endUserId?: string;
  walletAccountId?: string;
  status?: string;
  operationType?: string;
  destinationWalletAccountId?: string;
}
export interface WalletCardTopupRequest {
  creditWalletAccountId: string;
  amount: WalletAmount;
  currency: string;
  fundingMerchantId?: string;
  savedCardUserKey?: string;
  savedCardToken?: string;
  savedConsumerToken?: string;
  savedPublicCardStorageToken?: string;
  returnUrl?: string;
}
export interface WalletTopupRefundRequest {
  reason: string;
  requesterPrincipal: string;
  /** Must differ from `requesterPrincipal` (four eyes). */
  approverPrincipal: string;
}
export interface WalletAgentTopupRequest {
  agentId: string;
  creditWalletAccountId: string;
  amount: WalletAmount;
  currency: string;
}
export interface WalletPaymentRequest {
  buyerWalletNo?: string;
  buyerPhone?: string;
  amount: WalletAmount;
  currency: string;
  paymentPurpose: string;
  orderRef?: string;
  cashierRef?: string;
  otpDestination?: string;
  otpChannel?: WalletOtpChannelValue;
  locale?: string;
}
export interface WalletPaymentApproveRequest {
  buyerEndUserId: string;
  integrityHash: string;
  nonce: string;
  otpCode?: string;
  trustedActionToken?: string;
}
export interface WalletCollectRequest {
  code: string;
  amount: WalletAmount;
  currency: string;
  orderRef?: string;
  paymentPurpose?: string;
  locale?: string;
}
export interface WalletCreateQrRequest {
  qrType: WalletQrTypeValue;
  currency: string;
  targetEndUserId?: string;
  targetExternalCustomerId?: string;
  programId?: string;
  /** Required for dynamic QR codes, refused for static ones. */
  amount?: WalletAmount;
  expiresInSeconds?: number;
  metadata?: JsonObject;
}
export interface WalletQrFilters extends WalletPageFilters {
  programId?: string;
  qrType?: WalletQrTypeValue;
  status?: string;
  targetEndUserId?: string;
}
export interface WalletBulkPayoutItem {
  targetType: WalletBulkTargetTypeValue;
  targetRef: string;
  beneficiaryName?: string;
  amount: WalletAmount;
}
export interface WalletCreateBulkPayoutRequest {
  programId: string;
  sourceWalletAccountId: string;
  currency: string;
  items: WalletBulkPayoutItem[];
  reason?: string;
}

export class WalletPrograms {
  listMine(): Promise<WalletPage>;
  setCollectionAnchor(programId: string, options?: { collectionEndUserId?: string; reason?: string; expectedVersion?: number }): Promise<JsonObject>;
}
export class WalletEndUsers {
  create(request: WalletCreateEndUserRequest, idempotencyKey: string): Promise<JsonObject>;
  list(filters?: WalletEndUserFilters): Promise<WalletPage>;
  iterate(filters?: WalletEndUserFilters): AsyncGenerator<JsonObject, void, undefined>;
  get(endUserId: string): Promise<JsonObject>;
  getByExternalId(externalCustomerId: string, programId?: string): Promise<JsonObject>;
  freeze(endUserId: string, options: { reason?: string } | undefined, idempotencyKey: string): Promise<JsonObject>;
  getBalances(endUserId: string): Promise<JsonObject>;
  getKycLevel(endUserId: string): Promise<JsonObject>;
  updateKycLevel(endUserId: string, request: WalletUpdateKycLevelRequest, idempotencyKey: string): Promise<JsonObject>;
  getLimits(endUserId: string, filters?: { operationType?: string; currency?: string }): Promise<JsonObject>;
  createWallet(endUserId: string, options: { name?: string; currencies?: string[] } | undefined, idempotencyKey: string): Promise<JsonObject>;
}
export class WalletAccounts {
  createAccount(walletId: string, currency: string, idempotencyKey: string): Promise<JsonObject>;
  lookup(request: WalletLookupRequest): Promise<JsonObject>;
}
export class WalletDeposits {
  listInstructions(endUserId: string): Promise<JsonObject>;
  createInstruction(endUserId: string, options: { walletAccountId: string; currency?: string }): Promise<JsonObject>;
  simulateInboundCredit(request: WalletSimulateInboundCreditRequest): Promise<JsonObject>;
}
export class WalletCorporate {
  create(request: WalletCreateCorporateAccountRequest, idempotencyKey: string): Promise<JsonObject>;
  list(filters?: WalletCorporateFilters): Promise<WalletPage>;
  iterate(filters?: WalletCorporateFilters): AsyncGenerator<JsonObject, void, undefined>;
  importEmployees(corporateAccountId: string, rows: WalletEmployeeImportRow[], idempotencyKey: string): Promise<JsonObject>;
  offboardEmployees(corporateAccountId: string, rows: WalletEmployeeOffboardRow[], options: { reason?: string } | undefined, idempotencyKey: string): Promise<JsonObject>;
}
export class WalletFees {
  quote(request: WalletQuoteFeesRequest): Promise<JsonObject>;
}
export class WalletTransfers {
  quoteW2W(request: WalletW2WQuoteRequest): Promise<JsonObject>;
  initiateW2W(request: WalletW2WInitiateRequest, idempotencyKey: string): Promise<JsonObject>;
  completeW2W(operationId: string, request: WalletCompleteRequest, idempotencyKey: string): Promise<JsonObject>;
  quoteW2Iban(request: WalletIbanQuoteRequest): Promise<JsonObject>;
  initiateW2Iban(request: WalletIbanInitiateRequest, idempotencyKey: string): Promise<JsonObject>;
  completeW2Iban(operationId: string, request: WalletCompleteRequest, idempotencyKey: string): Promise<JsonObject>;
}
export class WalletWithdrawals {
  quote(request: WalletIbanQuoteRequest): Promise<JsonObject>;
  initiate(request: WalletIbanInitiateRequest, idempotencyKey: string): Promise<JsonObject>;
  complete(operationId: string, request: WalletCompleteRequest, idempotencyKey: string): Promise<JsonObject>;
  get(operationId: string): Promise<JsonObject>;
}
export class WalletOperations {
  list(filters?: WalletOperationFilters): Promise<WalletPage>;
  iterate(filters?: WalletOperationFilters): AsyncGenerator<JsonObject, void, undefined>;
  get(operationId: string): Promise<JsonObject>;
  getReceipt(operationId: string): Promise<JsonObject>;
}
export class WalletTopups {
  startCard(request: WalletCardTopupRequest, idempotencyKey: string): Promise<JsonObject>;
  get(operationId: string): Promise<JsonObject>;
  refund(operationId: string, request: WalletTopupRefundRequest): Promise<JsonObject>;
  agent(request: WalletAgentTopupRequest, idempotencyKey: string): Promise<JsonObject>;
}
export class WalletPayments {
  request(request: WalletPaymentRequest, idempotencyKey: string): Promise<JsonObject>;
  approve(operationId: string, request: WalletPaymentApproveRequest, idempotencyKey: string): Promise<JsonObject>;
  collect(request: WalletCollectRequest, idempotencyKey: string): Promise<JsonObject>;
  get(operationId: string): Promise<JsonObject>;
  getCommission(businessAccountId: string): Promise<JsonObject>;
}
export class WalletQr {
  create(request: WalletCreateQrRequest, idempotencyKey: string): Promise<JsonObject>;
  list(filters?: WalletQrFilters): Promise<WalletPage>;
  iterate(filters?: WalletQrFilters): AsyncGenerator<JsonObject, void, undefined>;
  get(qrId: string): Promise<JsonObject>;
  image(qrId: string, options?: { format?: WalletQrImageFormatValue; scale?: number }): Promise<BinaryResponse>;
  revoke(qrId: string): Promise<JsonObject>;
  parse(payload: string): Promise<JsonObject>;
}
export class WalletBulkPayouts {
  create(request: WalletCreateBulkPayoutRequest, idempotencyKey: string): Promise<JsonObject>;
  list(filters?: { programId?: string; status?: string; limit?: number }): Promise<WalletPage>;
  get(batchId: string): Promise<JsonObject>;
  listItems(batchId: string, filters?: { status?: string; limit?: number }): Promise<WalletPage>;
  submit(batchId: string): Promise<JsonObject>;
  approve(batchId: string, options?: { approve?: boolean; reason?: string }): Promise<JsonObject>;
  reject(batchId: string, options?: { reason?: string }): Promise<JsonObject>;
  process(batchId: string): Promise<JsonObject>;
  retryFailed(batchId: string): Promise<JsonObject>;
}

/** Wallet — `client.wallet`. Every call is signed; amounts are minor-unit digit strings. */
export class WalletClient {
  constructor(api: ApiClient);
  readonly programs: WalletPrograms;
  readonly endUsers: WalletEndUsers;
  readonly wallets: WalletAccounts;
  readonly deposits: WalletDeposits;
  readonly corporate: WalletCorporate;
  readonly fees: WalletFees;
  readonly transfers: WalletTransfers;
  readonly withdrawals: WalletWithdrawals;
  readonly operations: WalletOperations;
  readonly topups: WalletTopups;
  readonly payments: WalletPayments;
  readonly qr: WalletQr;
  readonly bulkPayouts: WalletBulkPayouts;
  ping(): Promise<JsonObject>;
}
