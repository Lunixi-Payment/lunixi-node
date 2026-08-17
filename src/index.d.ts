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
  stepUp?: boolean;
  idempotencyKey?: string | null;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export type JsonObject = Record<string, unknown>;

export class LunixiClient {
  constructor(options: LunixiClientOptions);
  readonly payments: PaymentClient;
  readonly tokens: TokenManager;
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
  request(method: string, path: string, body?: JsonObject | null, options?: RequestOptions): Promise<JsonObject>;
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

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: JsonObject;
  raw: JsonObject;
}

export class WebhookVerifier {
  constructor(secret: string, options?: { toleranceSeconds?: number });
  verify(rawBody: string | Buffer, headers?: Record<string, string | string[] | undefined>): WebhookEvent;
  static stableStringify(rawBody: string | Buffer): string;
  static payloadHash(rawBody: string | Buffer): string;
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
