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
  /** `Accept` header; default images for a binary request, JSON otherwise (not part of the signature). */
  accept?: string;
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
  readonly bankConnect: BankConnectClient;
  /** Sanctions screening (`/api/v1/sanction/*`). */
  readonly sanction: SanctionClient;
  /** Public reference data (Türkiye address codes for `ADDRESS` fields). */
  readonly reference: ReferenceClient;
  readonly insurance: InsuranceClient;
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

/** Item kind. Every endpoint that takes basket items accepts only these two (400 otherwise). */
export type BasketItemType = 'PHYSICAL' | 'VIRTUAL';

/** Item kind for insurance (`insuranceCategory`). */
export const InsuranceItemCategory: {
  readonly TICKET: 'TICKET';
  readonly HOTEL: 'HOTEL';
  readonly EVENT: 'EVENT';
  readonly DEVICE: 'DEVICE';
  readonly ELECTRONICS: 'ELECTRONICS';
  readonly VEHICLE: 'VEHICLE';
  readonly TRAVEL: 'TRAVEL';
  readonly HOME: 'HOME';
  readonly HEALTH: 'HEALTH';
  readonly PET: 'PET';
  readonly MICROMOBILITY: 'MICROMOBILITY';
  readonly MUSICAL_INSTRUMENT: 'MUSICAL_INSTRUMENT';
  readonly SHIPMENT: 'SHIPMENT';
  readonly EDUCATION: 'EDUCATION';
};
export type InsuranceItemCategoryValue = (typeof InsuranceItemCategory)[keyof typeof InsuranceItemCategory];

/**
 * Facts about the item that prefill the insurance type's fields. A key the
 * type uses goes to the same field of its type object
 * (`InsuranceProduct.typeObject`): the Checkout Form shows it filled in and the
 * buyer can change it, the products answer returns it in `prefill`, and a quote
 * starts from it (a field sent in the quote request wins). A key the type does
 * not use, or a value its schema does not accept, is left out; it does not stop
 * the payment or the quote. Send only the keys of the item's
 * `insuranceCategory`; an unknown key is a 400. It carries no personal data
 * (PNR, ticket number, IMEI, plate, chassis or serial number, address code,
 * identity) and no amounts: send those in `insuranceData`. Dates are
 * `YYYY-MM-DD`; `departureAt` is ISO 8601 with a time zone. Text values are
 * 1–100 characters (`hotelName` and `facilityName` 200); leave a key out
 * instead of sending an empty or placeholder value.
 */
export interface BasketItemInsuranceContext {
  /** TICKET */
  transportMode?: 'BUS' | 'FLIGHT' | 'TRAIN';
  /** TICKET */
  carrier?: string;
  /** TICKET — ISO 8601 with a time zone, e.g. `2025-12-23T12:50:00+03:00`. */
  departureAt?: string;
  /** TICKET */
  originCity?: string;
  /** TICKET */
  destinationCity?: string;
  /** TICKET — 3-letter IATA code. */
  originAirportCode?: string;
  /** TICKET — 3-letter IATA code. */
  destinationAirportCode?: string;
  /** TICKET */
  flightNumber?: string;
  /** TICKET */
  isPromotional?: boolean;
  /** HOTEL */
  hotelName?: string;
  /** HOTEL — `YYYY-MM-DD`. */
  checkInDate?: string;
  /** HOTEL — `YYYY-MM-DD`. */
  checkOutDate?: string;
  /** HOTEL — integer, at least 1. */
  guestCount?: number;
  /** HOTEL — Turkish province plate code `01`–`81`. */
  cityCode?: string;
  /** DEVICE, VEHICLE — Lunixi reference code. */
  brandCode?: string;
  /** DEVICE, VEHICLE — Lunixi reference code. */
  modelCode?: string;
  /** DEVICE, EVENT, MICROMOBILITY — `YYYY-MM-DD`. */
  coverageStartDate?: string;
  /** ELECTRONICS, MUSICAL_INSTRUMENT — Lunixi reference code. */
  categoryCode?: string;
  /** ELECTRONICS, MUSICAL_INSTRUMENT */
  brand?: string;
  /** ELECTRONICS, MUSICAL_INSTRUMENT */
  model?: string;
  /** ELECTRONICS */
  warrantyMonths?: 12 | 24;
  /** VEHICLE — integer. */
  modelYear?: number;
  /** VEHICLE — Lunixi reference code (`VEHICLE_TYPE`). */
  vehicleTypeCode?: string;
  /** VEHICLE — usage, Lunixi reference code (`VEHICLE_USAGE`). */
  vehicleUsageCode?: string;
  /** VEHICLE — seat count, integer 1–999. */
  seatCount?: number;
  /** TRAVEL */
  scope?: 'DOMESTIC' | 'INTERNATIONAL';
  /** TRAVEL, EDUCATION — `YYYY-MM-DD`. */
  startDate?: string;
  /** TRAVEL, EDUCATION — `YYYY-MM-DD`. */
  endDate?: string;
  /** TRAVEL, EDUCATION — ISO 3166-1 alpha-2 codes, at most 20. */
  destinationCountryCodes?: string[];
  /** HEALTH — procedure or cover, Lunixi reference code (`MEDICAL_PROCEDURE_COVER`). */
  procedureCoverCode?: string;
  /** HEALTH — procedure date, `YYYY-MM-DD`. */
  procedureDate?: string;
  /** HEALTH — name of the health facility, 1–200 characters. */
  facilityName?: string;
  /** PET */
  petSpecies?: 'CAT' | 'DOG';
  /** PET — breed, Lunixi reference code (`PET_BREED`). */
  petBreedCode?: string;
  /** HOME — gross area in square metres, integer 1–100000. */
  areaSqm?: number;
  /** HOME — construction year, integer. */
  constructionYear?: number;
  /** HOME — dwelling type, Lunixi reference code (`DWELLING_TYPE`). */
  dwellingTypeCode?: string;
  /** SHIPMENT — origin province, plate code `01`–`81`. */
  originCityCode?: string;
  /** SHIPMENT — destination province, plate code `01`–`81`. */
  destinationCityCode?: string;
  /** SHIPMENT — departure date, `YYYY-MM-DD`. */
  departureDate?: string;
}

/**
 * Insurance data of a basket item (`insuranceData`): what the quote needs that
 * only you know (the insured, the PNR, the IMEI, the plate …), so the buyer is
 * not asked again.
 *
 * The keys are the root fields of the insurance type's quote body
 * (`createQuote()`): `policyholder`, `insured` and the type object
 * (`InsuranceProduct.typeObject`). Field names and formats are those of the
 * type's fields (`InsuranceProduct.fields`, the insurance types reference);
 * there is no other vocabulary. A list type object (`tickets`) is ONE object
 * here, for this item; never send `basketItemId`, the item's `id` is used.
 *
 * Partial data is allowed: required fields are not checked on the basket, the
 * Checkout Form asks the buyer only for what is missing. When everything the
 * quote needs is there, the form prices the insurance on its own; the buyer
 * still ticks the box and the insurer's consent. The gateway checks the shape
 * (an object of at most 16 KB as JSON, known roots only, `insured` a list of
 * 1–10 objects, the format of each known field, no `null` values) and answers
 * 400 with the field path, never the value. Data the type's schema does not
 * accept does not stop the payment: it is not stored, the buyer is asked for
 * it and the products answer lists why in `insuranceDataIssues`.
 *
 * It carries personal data. It never reaches the payment provider or the
 * payment record: it is stored encrypted for the insurance quote only and
 * erased after the payment intent expires. The Checkout Form shows the fields
 * masked and read-only (the buyer can replace them); the products answer
 * returns them masked in `providedFields`. Needs `insuranceCategory` on the
 * item; an insurance premium item (`id` `inso_…`) cannot carry it. Leave it
 * out instead of sending `{}`.
 */
export interface BasketItemInsuranceData {
  /** Policyholder: person fields (`identityType`, `identityNumber`, `firstName`, `lastName`, `birthDate`, `email`, `phone`, `address` …). */
  policyholder?: JsonObject;
  /** Insured persons, 1–10 (`identityType` with `identityNumber`, `birthDate`, `email`, `phone` …). */
  insured?: JsonObject[];
  /** `TICKET_CANCELLATION` — one object for this item (`pnr`, `ticketNumber`, `carrier`, `priceAmount` …), no `basketItemId`. */
  tickets?: JsonObject;
  /** `HOTEL_CANCELLATION` */
  stay?: JsonObject;
  /** `DEVICE_INSURANCE`, `DEVICE_PROTECTION` (`imei`, `serialNumber`, `deviceValueAmount` …) */
  device?: JsonObject;
  /** `EXTENDED_WARRANTY` */
  product?: JsonObject;
  /**
   * `ROADSIDE_ASSISTANCE`, `VEHICLE_TAG_PROTECTION`, `MOTOR_GREEN_CARD`,
   * `MOTOR_THIRD_PARTY_LIABILITY`, `MOTOR_COMPREHENSIVE`,
   * `MOTOR_EXCESS_LIABILITY` (`plate`, `chassisNumber`, `engineNumber`,
   * `registrationDocument` …)
   */
  vehicle?: JsonObject;
  /** `TRAVEL_HEALTH`, `INBOUND_TRAVEL_HEALTH` */
  trip?: JsonObject;
  /** `MICROMOBILITY_ACCIDENT` */
  rental?: JsonObject;
  /** `MUSICAL_INSTRUMENT_PROTECTION` */
  instrument?: JsonObject;
  /** `EVENT_ACCIDENT` */
  event?: JsonObject;
  /** `PERSONAL_ACCIDENT` */
  accident?: JsonObject;
  /** `MEDICAL_COMPLICATION` */
  procedure?: JsonObject;
  /** `PET_HEALTH` */
  pet?: JsonObject;
  /** `FOREIGN_RESIDENT_HEALTH` */
  residence?: JsonObject;
  /** `ABROAD_STAY_HEALTH` */
  abroadStay?: JsonObject;
  /** `COMPULSORY_EARTHQUAKE`, `HOME_INSURANCE` (`uavtAddressCode` …) */
  property?: JsonObject;
  /** `SUPPLEMENTARY_HEALTH` */
  health?: JsonObject;
}

/**
 * A basket line. `price` is the line total in minor units.
 *
 * The `insurance*` fields are optional. A payment accepts them only on
 * `createIntent` (`POST /api/v1/payments/intents`, Checkout Form);
 * `directMethodPayment` (`direct/payment`) answers them with 400. The insurance
 * calls take the same items in `context.items` (`searchProducts`,
 * `createQuote`). They do not reach the payment provider. When any item
 * carries one, the `id`s in the basket must be unique.
 */
export interface BasketItemFields {
  id?: string;
  price?: number;
  name?: string;
  category1?: string;
  category2?: string;
  itemType?: BasketItemType;
  /** Required when `insuranceTypes`, `insuranceValueAmount`, `insuranceContext` or `insuranceData` is sent. */
  insuranceCategory?: InsuranceItemCategoryValue;
  /** Lunixi insurance type codes (e.g. `TICKET_CANCELLATION`), unique, at most 10. Narrows the category's types. */
  insuranceTypes?: string[];
  /** `false`: no insurance is offered for this item, whatever the other fields say. */
  insuranceEligible?: boolean;
  /** Insured value of one unit, minor units, integer >= 1. Defaults to the unit price. */
  insuranceValueAmount?: number;
  insuranceContext?: BasketItemInsuranceContext;
  /** Insurance data for the quote; personal data, stored encrypted by Lunixi only for insurance. */
  insuranceData?: BasketItemInsuranceData;
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
  /** Fields are sent as given; `undefined` and `null` values are left out. */
  constructor(fields?: BasketItemFields);
  toJSON(): BasketItemFields;
}

/**
 * Amount fields removed from the payment bodies: `amount` is the only amount
 * field. A body carrying one of them is refused with 400
 * `payment.amount.field_removed`; the SDK throws `ConfigurationError` first.
 */
export const REMOVED_AMOUNT_FIELDS: readonly ['price', 'paidPrice'];

export class CreateIntentRequest {
  /**
   * `amount`: the basket total in minor units (integer ≥ 1), without any
   * installment fee; basket item `price` values must add up to it. Anything else
   * throws `ConfigurationError`.
   */
  constructor(amount: number, currency: string, orderId: string);
  withCallbackUrl(value: string): this;
  withDescription(value: string): this;
  withCustomerId(value: string): this;
  withCardUserKey(value: string): this;
  withMethod(value: string): this;
  withPaymentMethod(value: string): this;
  withWalletProvider(value: string): this;
  /**
   * Senetle Ödeme on the hosted form: your schedule (`[{ amount, dueDate }]`,
   * minor units adding up to `amount`, `YYYY-MM-DD` ascending, at most 24 rows).
   * The form shows the plan; without it the buyer chooses the number of notes.
   * Only with no `paymentMethod` or `PROMISSORY_NOTE`. Invalid rows throw
   * `ConfigurationError`.
   */
  withPromissoryNoteSchedule(schedule: PromissoryNoteScheduleRow[]): this;
  withForce3D(value: boolean): this;
  /**
   * Pre-authorization. `true` holds the amount on the card and the payment becomes
   * `AUTHORIZED`; take it later with `payments.capture()` or release it with
   * `payments.void()`. `false` (or not calling this) captures immediately.
   * A non-boolean value throws `ConfigurationError`.
   */
  withPreauth(value: boolean): this;
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

// ─────────────────────────── Payment methods ───────────────────────────

export const PaymentMethod: {
  readonly CARD: 'CARD';
  readonly BNPL: 'BNPL';
  readonly SHOPPING_LOAN: 'SHOPPING_LOAN';
  readonly PROMISSORY_NOTE: 'PROMISSORY_NOTE';
  readonly MEAL_CARD: 'MEAL_CARD';
  readonly GIFT_CARD: 'GIFT_CARD';
  readonly CASH: 'CASH';
  readonly CASH_ON_DELIVERY: 'CASH_ON_DELIVERY';
  readonly WALLET: 'WALLET';
  readonly BANK_TRANSFER: 'BANK_TRANSFER';
  readonly OPEN_BANKING: 'OPEN_BANKING';
  /** Faturana Yansıt (charge to the mobile phone bill). */
  readonly MOBILE_BILLING: 'MOBILE_BILLING';
  readonly QR_CODE: 'QR_CODE';
  readonly CRYPTO: 'CRYPTO';
  readonly OTHER: 'OTHER';
};
export type PaymentMethodCode = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentActionType: {
  readonly OTP: 'OTP';
  readonly REDIRECT: 'REDIRECT';
  readonly DISPLAY: 'DISPLAY';
  readonly APP_APPROVAL: 'APP_APPROVAL';
  readonly INPUT: 'INPUT';
};
export type PaymentActionTypeValue = (typeof PaymentActionType)[keyof typeof PaymentActionType];

export const ProviderSelection: { readonly ROUTED: 'ROUTED'; readonly OPTIONAL: 'OPTIONAL'; readonly REQUIRED: 'REQUIRED' };
export type ProviderSelectionValue = (typeof ProviderSelection)[keyof typeof ProviderSelection];

/**
 * Who picks a method's provider (`providerSelectionMode`). `BUYER`: the buyer
 * picks the brand; with more than one provider `providerCode` is required.
 * `PLATFORM`: the buyer picks no brand; `providerCode` is optional and, when it
 * is omitted, the platform picks a connected provider (422
 * `payment.provider.none_eligible` when none can take the payment).
 */
export const ProviderSelectionMode: { readonly BUYER: 'BUYER'; readonly PLATFORM: 'PLATFORM' };
export type ProviderSelectionModeValue = (typeof ProviderSelectionMode)[keyof typeof ProviderSelectionMode];

export const MethodInputFieldType: {
  readonly PHONE: 'PHONE';
  readonly TCKN: 'TCKN';
  readonly EMAIL: 'EMAIL';
  readonly DATE: 'DATE';
  readonly TEXT: 'TEXT';
  readonly NUMBER: 'NUMBER';
  readonly SELECT: 'SELECT';
  readonly CONSENT: 'CONSENT';
  /** 10-digit Turkish tax number with checksum. */
  readonly VKN: 'VKN';
  /** `{ provinceCode, districtCode, neighborhoodCode, line }`; codes from `client.reference`. */
  readonly ADDRESS: 'ADDRESS';
  /** List of objects validated by `itemFields`; `minItems` / `maxItems` bound the count. */
  readonly GROUP: 'GROUP';
};
export type MethodInputFieldTypeValue = (typeof MethodInputFieldType)[keyof typeof MethodInputFieldType];

/** Body fields of `POST /payments/direct/payment` (the gateway answers any other key with 400). */
export const DIRECT_METHOD_PAYMENT_FIELDS: readonly string[];
/** Body fields a merchant server sends to the confirm endpoint. */
export const PAYMENT_ACTION_CONFIRM_FIELDS: readonly ['otp', 'consentAccepted', 'fields'];

/** A scalar field value. */
export type MethodFieldScalar = string | number | boolean;
/** An `ADDRESS` value (at most 16 scalar fields). */
export type MethodFieldObject = Record<string, MethodFieldScalar>;
/** One item of a `GROUP` value. */
export type MethodFieldGroupItem = Record<string, MethodFieldScalar | MethodFieldObject>;
/**
 * Values of a method block or of confirm `fields`, keyed by `inputFields[].key`:
 * a scalar, an object (`ADDRESS`) or a list of at most 10 objects (`GROUP`).
 */
export type MethodFields = Record<string, MethodFieldScalar | MethodFieldObject | MethodFieldGroupItem[]>;

export class DirectMethodPaymentRequest {
  /** `amount`: the basket total in minor units (integer ≥ 1), without any installment fee. */
  constructor(amount: number, currency: string, orderId: string);
  /**
   * Pays with a method other than card. `fields` are the provider's `inputFields`
   * values; `providerCode` may be null when `providerSelection` is `OPTIONAL`
   * (with `providerSelectionMode: PLATFORM` the platform then picks the provider).
   */
  withMethodFields(paymentMethod: Exclude<PaymentMethodCode, 'CARD'> | 'QR' | string, providerCode: string | null, fields?: MethodFields): this;
  /**
   * Senetle Ödeme plan, one note per row: amounts in minor units adding up to
   * `amount`, `YYYY-MM-DD` due dates after today (Istanbul) in ascending order,
   * at most 24 rows. Replaces a note count.
   */
  withPromissoryNoteSchedule(schedule: PromissoryNoteScheduleRow[]): this;
  /**
   * Senetle Ödeme plan by number of notes (1–24, within your provider connection
   * limits). Sent as the string `noteCount`. Replaces a schedule.
   */
  withPromissoryNoteCount(count: number | string): this;
  /**
   * Pays by card: the only server-side card charge. `withForce3D(true)` for 3D
   * Secure. A stored card: `cardUserKey` + `cardToken` in `CardDetails`.
   */
  withCard(card: CardDetails | CardDetailsFields): this;
  /** Card only. `quoteToken` binds the charge to a quote; the system adds the installment fee. */
  withInstallment(value: number, quoteToken?: string | null): this;
  /** Card only. `true`: 3D Secure; the response carries a `REDIRECT` action. */
  withForce3D(value: boolean): this;
  /**
   * Pre-authorization. `true` holds the amount and the payment becomes `AUTHORIZED`.
   * A method whose providers do not support it is refused with 422
   * `payment.preauth.unsupported_for_method`. A non-boolean throws `ConfigurationError`.
   */
  withPreauth(value: boolean): this;
  /** Where the buyer's browser returns after a `REDIRECT` action, with the signed result form. */
  withCallbackUrl(value: string): this;
  withLocale(value: string): this;
  withDescription(value: string): this;
  withCustomerId(value: string): this;
  withPaymentChannel(value: string): this;
  withPaymentGroup(value: string): this;
  withBuyer(value: Buyer | BuyerFields): this;
  withBillingAddress(value: Address | AddressFields): this;
  withShippingAddress(value: Address | AddressFields): this;
  withBasketItems(value: Array<BasketItem | BasketItemFields>): this;
  withMetadata(value: JsonObject): this;
  toJSON(): JsonObject;
}

export interface PaymentActionConfirmInput {
  /** The code the buyer entered (`action.type = OTP`), digits only. */
  otp?: string;
  /** Required as `true` when `action.consent.required` is true. */
  consentAccepted?: boolean;
  /** Values an `INPUT` action asks for (`action.input.fields`). */
  fields?: MethodFields;
}

export interface LocalizedLabel {
  tr: string;
  en: string;
}

/** A field the provider asks the buyer for. Send the value in the method block under `key`. */
export interface MethodInputField {
  key: string;
  type: MethodInputFieldTypeValue;
  required: boolean;
  label: LocalizedLabel;
  /** Buyer data used when the field is omitted (still validated), e.g. `buyer.gsmNumber`. */
  prefill: string | null;
  /** Personal data: not logged, stored in metadata or returned by the gateway. */
  pii: boolean;
  pattern: string | null;
  minLength: number | null;
  maxLength: number | null;
  options: Array<{ value: string; label: LocalizedLabel }>;
  /** CONSENT: agreement URL. */
  url: string | null;
  /** Required when the sibling SELECT field `field` equals `equals`; otherwise leave the field out. */
  requiredWhen: { field: string; equals: string } | null;
  /** GROUP: fields of each item; empty for other types. */
  itemFields: MethodInputField[];
  /** GROUP: least items; null = none. */
  minItems: number | null;
  /** GROUP: most items; null = platform cap (10). */
  maxItems: number | null;
}

export interface PaymentMethodProvider {
  providerCode: string;
  displayName: string;
  logoUrl: string | null;
  actionTypes: PaymentActionTypeValue[];
  currencies: string[];
  /** Minor units; null = no limit. */
  minAmount: number | null;
  maxAmount: number | null;
  /** Whether `preauth: true` is accepted with this provider. */
  preauth: boolean;
  inputFields: MethodInputField[];
  /**
   * Whether this provider can be used in a split payment leg now: it supports
   * split payments and split payments with this method are enabled in your
   * form settings.
   */
  splitEligible: boolean;
  /** How the provider behaves in a split payment; null when it cannot be used in one. */
  splitBehavior: SplitBehaviorValue | null;
}

export interface PaymentMethodInfo {
  paymentMethod: PaymentMethodCode;
  category: string;
  /** Name of the method block in the request body (`mobileBilling`, `wallet`, `card`). */
  blockName: string;
  /** Label from your form settings. */
  displayName: string | null;
  providerSelection: ProviderSelectionValue;
  /**
   * API behaviour. `BUYER`: send `providerCode` when more than one provider is
   * connected. `PLATFORM`: `providerCode` may be left out and the platform then
   * picks the provider. In the Checkout Form the buyer always picks.
   */
  providerSelectionMode: ProviderSelectionModeValue;
  actionTypes: PaymentActionTypeValue[];
  currencies: string[];
  minAmount: number | null;
  maxAmount: number | null;
  preauth: boolean;
  /**
   * Empty for CARD (routing picks the provider). In the order set in your form
   * settings; a provider turned off only in the checkout form is still listed.
   */
  providers: PaymentMethodProvider[];
  /** Whether the method can be a split payment leg now (CARD: always). */
  splitEligible: boolean;
  /**
   * Common split behaviour of the method's providers (CARD: `HOLD_CAPTURE`);
   * null when no provider can be used or they differ (read `providers[].splitBehavior`).
   */
  splitBehavior: SplitBehaviorValue | null;
}

export interface PaymentAction {
  /** `act_…` (card 3D Secure: `3ds_<paymentId>`); pass it to confirm or resend. */
  id: string;
  type: PaymentActionTypeValue;
  expiresAt: string;
  otp?: { maskedTarget?: string };
  consent?: { required: boolean; url?: string };
  input?: { fields: MethodInputField[] };
  /** Amount the buyer pays including fees and tax (minor units). */
  charge?: { amount: number; feeTotal: number; taxTotal: number; buyerTotalCharge: number; currency: string };
  maskedBusinessName?: string;
  stepUpRequired?: true;
  redirect?: { url: string };
}

/** A card saved by this payment (card, 3D Secure with `cardSave: true`). */
export interface MethodPaymentSavedCard {
  storedCardToken: string;
  cardUserKey: string;
  maskedNumber: string;
  binNumber: string;
  lastFour: string;
  expireMonth: string;
  expireYear: string;
  cardBrand?: string;
  cardType?: string;
  cardFamily?: string;
  bankCode?: string;
  provider?: string;
  cardName?: string;
  deduplicated: boolean;
}

export interface MethodPayment {
  paymentId: string;
  orderId: string;
  /** `CAPTURED`, `AUTHORIZED`, `INITIATED`, `PROCESSING`, `NEEDS_RECONCILIATION`, `FAILED` … */
  status: string;
  paymentMethod: PaymentMethodCode;
  providerCode?: string;
  /** Present while the buyer must act. */
  action?: PaymentAction;
  savedCard?: MethodPaymentSavedCard;
}

/** The gateway response envelope. */
export interface GatewayResponse<T> {
  status: 'success' | 'partial' | 'failure';
  code: string;
  message: string;
  data: T;
  statusCode: number;
  timestamp?: string;
  requestId?: string;
  details?: JsonObject;
  [key: string]: unknown;
}

export type MethodPaymentResponse = GatewayResponse<MethodPayment>;
export type PaymentMethodListResponse = GatewayResponse<{ methods: PaymentMethodInfo[] }>;

/** Options of `payments.listPaymentMethods()`. */
export interface ListPaymentMethodsOptions {
  /** Lists this method only (`QR` is sent as `QR_CODE`); `{ methods: [] }` when it is not open. */
  paymentMethod?: PaymentMethodCode | 'QR';
}

/** `details` of 422 `payment.provider.none_eligible`. */
export interface ProviderNoneEligibleDetails {
  paymentMethod: PaymentMethodCode;
  candidates: Array<{
    providerCode: string;
    /** `INELIGIBLE`: final. `UNAVAILABLE` / `NOT_CHECKED`: the same request may be retried later. */
    outcome: 'INELIGIBLE' | 'UNAVAILABLE' | 'NOT_CHECKED';
    reason: string;
  }>;
}

// ─────────────────────────── Senetle Ödeme ───────────────────────────

/** One note of a promissory-note plan. */
export interface PromissoryNoteScheduleRow {
  /** Minor units, integer ≥ 1. */
  amount: number;
  /** `YYYY-MM-DD`. */
  dueDate: string;
}

/** Most rows of a schedule. */
export const PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS: 24;

export const PromissoryNoteStatus: {
  readonly ISSUED: 'ISSUED';
  readonly PAID: 'PAID';
  readonly PROTESTED: 'PROTESTED';
  readonly CANCELLED: 'CANCELLED';
};
export type PromissoryNoteStatusValue = (typeof PromissoryNoteStatus)[keyof typeof PromissoryNoteStatus];

export const PromissoryNoteDocumentType: { readonly PROMISSORY_NOTE: 'PROMISSORY_NOTE'; readonly PAYMENT_ORDER: 'PAYMENT_ORDER' };
export type PromissoryNoteDocumentTypeValue = (typeof PromissoryNoteDocumentType)[keyof typeof PromissoryNoteDocumentType];

export const PromissoryNoteCancelResult: {
  readonly CANCELLED: 'CANCELLED';
  readonly ALREADY_CLOSED: 'ALREADY_CLOSED';
  readonly NOT_CANCELLABLE: 'NOT_CANCELLABLE';
  readonly FAILED: 'FAILED';
};
export type PromissoryNoteCancelResultValue = (typeof PromissoryNoteCancelResult)[keyof typeof PromissoryNoteCancelResult];

/** `cancelResults[].errorCode`: a Lunixi code (never the provider's), or null. */
export const PromissoryNoteCancelErrorCode: {
  readonly NOT_CANCELLABLE: 'payment.promissory_note.not_cancellable';
  /** Temporary; cancel again later. */
  readonly PROVIDER_UNAVAILABLE: 'payment.promissory_note.provider_unavailable';
  /** Permanent refusal. */
  readonly CANCEL_REJECTED: 'payment.promissory_note.cancel_rejected';
};
export type PromissoryNoteCancelErrorCodeValue = (typeof PromissoryNoteCancelErrorCode)[keyof typeof PromissoryNoteCancelErrorCode];

export const PromissoryNoteDocumentLocale: { readonly TR: 'tr-TR'; readonly EN: 'en-GB' };
export type PromissoryNoteDocumentLocaleValue = (typeof PromissoryNoteDocumentLocale)[keyof typeof PromissoryNoteDocumentLocale];

/** Webhook event types of a note (`payment.*` envelope, payload `promissoryNote`). */
export const PromissoryNoteEvents: {
  readonly PAID: 'payment.promissory_note.paid';
  readonly PROTESTED: 'payment.promissory_note.protested';
  readonly CANCELLED: 'payment.promissory_note.cancelled';
};
export type PromissoryNoteEventType = (typeof PromissoryNoteEvents)[keyof typeof PromissoryNoteEvents];

export interface PromissoryNote {
  serialNumber: string;
  /** 1-based position in the plan. */
  sequence: number;
  /** Minor units. */
  amount: number;
  dueDate: string;
  status: PromissoryNoteStatusValue;
  paidAt: string | null;
  protestedAt: string | null;
  cancelledAt: string | null;
}

export interface PromissoryNoteCancelOutcome {
  serialNumber: string;
  result: PromissoryNoteCancelResultValue;
  /** Lunixi code for `NOT_CANCELLABLE` / `FAILED`; null otherwise. */
  errorCode: PromissoryNoteCancelErrorCodeValue | null;
}

export interface PromissoryNotes {
  paymentId: string;
  providerCode: string;
  documentType: PromissoryNoteDocumentTypeValue;
  /** Serial number of the issue (all notes of the payment). */
  rowSerialNumber: string;
  currency: string;
  /** Minor units. */
  totalAmount: number;
  notes: PromissoryNote[];
  /** Only in the answer of `cancelPromissoryNotes()`. */
  cancelResults?: PromissoryNoteCancelOutcome[];
}

export type PromissoryNotesResponse = GatewayResponse<PromissoryNotes>;

/** `payload.promissoryNote` of a `payment.promissory_note.*` webhook. */
export interface PromissoryNoteEventData {
  serialNumber: string;
  sequence: number;
  /** Minor units as a digit string. */
  amountMinor: string;
  dueDate: string;
  status: 'PAID' | 'PROTESTED' | 'CANCELLED';
  occurredAt: string;
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

// ─────────────────────────── Split payments ───────────────────────────

export const SplitBehavior: {
  readonly APPROVE_THEN_DISBURSE: 'APPROVE_THEN_DISBURSE';
  readonly HOLD_CAPTURE: 'HOLD_CAPTURE';
  readonly CAPTURE_REVERSIBLE: 'CAPTURE_REVERSIBLE';
  readonly CAPTURE_IRREVERSIBLE: 'CAPTURE_IRREVERSIBLE';
};
export type SplitBehaviorValue = (typeof SplitBehavior)[keyof typeof SplitBehavior];

export const SplitPaymentStatus: {
  readonly COMPOSING: 'COMPOSING';
  readonly AUTHORIZING: 'AUTHORIZING';
  readonly AWAITING_3DS: 'AWAITING_3DS';
  readonly AWAITING_ACTION: 'AWAITING_ACTION';
  readonly AWAITING_CREDIT_APPROVAL: 'AWAITING_CREDIT_APPROVAL';
  readonly AWAITING_REPLACEMENT_CARD: 'AWAITING_REPLACEMENT_CARD';
  readonly AUTHORIZED: 'AUTHORIZED';
  readonly CAPTURING: 'CAPTURING';
  readonly COMPLETED: 'COMPLETED';
  readonly COMPENSATING: 'COMPENSATING';
  readonly VOIDED: 'VOIDED';
  readonly FAILED: 'FAILED';
  readonly RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED';
};
export type SplitPaymentStatusValue = (typeof SplitPaymentStatus)[keyof typeof SplitPaymentStatus];

/** Statuses of a running split payment; `createSplitPayment()` returns these answers instead of throwing. */
export const SPLIT_PAYMENT_IN_PROGRESS_STATUSES: readonly SplitPaymentStatusValue[];

export const SplitLegStatus: {
  readonly PENDING: 'PENDING';
  readonly AUTHORIZING: 'AUTHORIZING';
  readonly AWAITING_3DS: 'AWAITING_3DS';
  readonly AWAITING_ACTION: 'AWAITING_ACTION';
  readonly AUTHORIZED: 'AUTHORIZED';
  readonly CAPTURED: 'CAPTURED';
  readonly VOIDED: 'VOIDED';
  readonly REFUNDED: 'REFUNDED';
  readonly COMPENSATING: 'COMPENSATING';
  readonly FAILED: 'FAILED';
};
export type SplitLegStatusValue = (typeof SplitLegStatus)[keyof typeof SplitLegStatus];

export const SplitStepKind: { readonly CARD: 'CARD'; readonly METHOD: 'METHOD' };
export type SplitStepKindValue = (typeof SplitStepKind)[keyof typeof SplitStepKind];

export const SplitPendingStep: {
  readonly THREE_DS: 'THREE_DS';
  readonly START_METHOD: 'START_METHOD';
  readonly ACTION: 'ACTION';
  readonly RESULT_PENDING: 'RESULT_PENDING';
  readonly CREDIT_APPROVAL: 'CREDIT_APPROVAL';
  readonly CARD_INPUT: 'CARD_INPUT';
  readonly REPLACEMENT_CARD: 'REPLACEMENT_CARD';
};
export type SplitPendingStepValue = (typeof SplitPendingStep)[keyof typeof SplitPendingStep];

export const SplitLegRefundState: { readonly REFUND_PENDING: 'REFUND_PENDING'; readonly REFUNDED: 'REFUNDED'; readonly NOT_REFUNDABLE: 'NOT_REFUNDABLE' };
export type SplitLegRefundStateValue = (typeof SplitLegRefundState)[keyof typeof SplitLegRefundState];

export const SplitRefundStatus: { readonly PROCESSING: 'PROCESSING'; readonly COMPLETED: 'COMPLETED'; readonly PARTIAL: 'PARTIAL'; readonly FAILED: 'FAILED' };
export type SplitRefundStatusValue = (typeof SplitRefundStatus)[keyof typeof SplitRefundStatus];

export const SplitRefundLegStatus: { readonly PENDING: 'PENDING'; readonly SUCCEEDED: 'SUCCEEDED'; readonly FAILED: 'FAILED' };
export type SplitRefundLegStatusValue = (typeof SplitRefundLegStatus)[keyof typeof SplitRefundLegStatus];

export const PaymentSplitRole: { readonly PARENT: 'PARENT'; readonly LEG: 'LEG' };
export type PaymentSplitRoleValue = (typeof PaymentSplitRole)[keyof typeof PaymentSplitRole];

export const SplitReconciliationReason: {
  readonly REPLACEMENT_CARD_FAILED: 'REPLACEMENT_CARD_FAILED';
  readonly REPLACEMENT_WINDOW_EXPIRED: 'REPLACEMENT_WINDOW_EXPIRED';
  readonly BUYER_ABANDONED: 'BUYER_ABANDONED';
  readonly CAPTURE_NOT_RECOVERABLE: 'CAPTURE_NOT_RECOVERABLE';
};
export type SplitReconciliationReasonValue = (typeof SplitReconciliationReason)[keyof typeof SplitReconciliationReason];

/** Webhook event types of a split payment (the main result arrives as `payment.captured` / `payment.failed`). */
export const SplitPaymentEvents: {
  readonly COMPLETED: 'payment.split.completed';
  readonly VOIDED: 'payment.split.voided';
  readonly COMPENSATING: 'payment.split.compensating';
  readonly OUTCOME_PENDING: 'payment.split.outcome_pending';
  readonly RECONCILIATION_REQUIRED: 'payment.split.reconciliation_required';
  /** Leg event (needs `SPLIT_LEG_EVENTS_SUBSCRIPTION`). */
  readonly LEG_REFUND_PENDING: 'payment.split.leg_refund_pending';
};
export type SplitPaymentEventType = (typeof SplitPaymentEvents)[keyof typeof SplitPaymentEvents];

/** Event-type key that turns on leg events for a webhook endpoint (not an event type; `payment.*` does not include it). */
export const SPLIT_LEG_EVENTS_SUBSCRIPTION: 'payment.split.leg_events';

export const SplitPayErrorCode: {
  readonly METHODS_DISABLED: 'split_pay.validation.methods_disabled';
  readonly METHOD_NOT_ALLOWED: 'split_pay.validation.method_not_allowed';
  readonly PROVIDER_NOT_AVAILABLE: 'split_pay.validation.provider_not_available';
  readonly PROVIDER_NOT_SPLIT_ELIGIBLE: 'split_pay.validation.provider_not_split_eligible';
  readonly DUPLICATE_PROVIDER: 'split_pay.validation.duplicate_provider';
  readonly MULTIPLE_IRREVERSIBLE_LEGS: 'split_pay.validation.multiple_irreversible_legs';
  readonly LEG_BELOW_MINIMUM: 'split_pay.validation.leg_below_minimum';
  readonly LEG_OUTSIDE_PROVIDER_LIMITS: 'split_pay.validation.leg_outside_provider_limits';
  readonly CARD_LEG_COUNT_OUT_OF_RANGE: 'split_pay.validation.card_leg_count_out_of_range';
  readonly INVALID_INSTALLMENT: 'split_pay.validation.invalid_installment';
  readonly INSTALLMENT_QUOTE_REJECTED: 'split_pay.validation.installment_quote_rejected';
  readonly AMOUNT_MISMATCH: 'split_pay.validation.amount_mismatch';
  readonly LEG_COUNT_OUT_OF_RANGE: 'split_pay.validation.leg_count_out_of_range';
  readonly INVALID_LEG_AMOUNT: 'split_pay.validation.invalid_leg_amount';
  readonly CURRENCY_MISMATCH: 'split_pay.validation.currency_mismatch';
  readonly MISSING_CARD_TOKEN: 'split_pay.validation.missing_card_token';
  readonly STEP_NOT_ALLOWED: 'split_pay.step.not_allowed';
  readonly STEP_BUSY: 'split_pay.step.busy';
  readonly CONTINUATION_UNAVAILABLE: 'split_pay.continuation.unavailable';
  readonly RESUME_UNAVAILABLE: 'split_pay.resume.unavailable';
  readonly RESUME_ALREADY_OPENED: 'split_pay.resume.already_opened';
  readonly RESUME_PROOF_INVALID: 'split_pay.resume.proof_invalid';
  readonly RESUME_NOT_CONFIGURED: 'split_pay.resume.not_configured';
  readonly THREE_DS_RESTART_EXHAUSTED: 'split_pay.three_ds.restart_exhausted';
  readonly THREE_DS_RESTART_EXPIRED: 'split_pay.three_ds.restart_expired';
  readonly CHECKOUT_ORDER_NOT_OPEN: 'split_pay.checkout.order_not_open';
  readonly INSURANCE_REQUIRES_CARD_LEG: 'split_pay.insurance.requires_card_leg';
  readonly REFUND_AMOUNT_EXCEEDED: 'split_pay.refund.amount_exceeded';
  readonly REFUND_AMOUNT_NOT_DISTRIBUTABLE: 'split_pay.refund.amount_not_distributable';
  readonly REFUND_NOT_ALLOWED: 'split_pay.refund.not_allowed';
  readonly REFUND_INCOMPLETE: 'split_pay.refund.incomplete';
};
export type SplitPayErrorCodeValue = (typeof SplitPayErrorCode)[keyof typeof SplitPayErrorCode];

/** Checkout Form codes of payment options and the order lock. */
export const CheckoutFormErrorCode: {
  readonly PROVIDER_DISABLED_IN_FORM: 'payment.provider.disabled_in_form';
  readonly METHOD_SELECTION_ATTEMPTS_EXHAUSTED: 'payment.method.selection_attempts_exhausted';
  readonly ORDER_LOCKED: 'payment.checkout.order_locked';
};
export type CheckoutFormErrorCodeValue = (typeof CheckoutFormErrorCode)[keyof typeof CheckoutFormErrorCode];

/** `details.reason` of 409 `split_pay.step.not_allowed`. */
export type SplitStepNotAllowedReason =
  | 'SPLIT_NOT_WAITING'
  | 'NOT_CURRENT_LEG'
  | 'LEG_NOT_STARTABLE'
  | 'PROVIDER_MISMATCH'
  | 'METHOD_MISMATCH'
  | 'SPLIT_EXPIRED'
  | 'REPLACEMENT_WINDOW_CLOSED'
  | 'CARD_LEG_REQUIRED'
  | 'CARD_SOURCE_UNSUPPORTED';
/** `details.reason` of 409 `split_pay.refund.not_allowed`. */
export type SplitRefundNotAllowedReason = 'SPLIT_NOT_COMPLETED' | 'SPLIT_IN_PROGRESS' | 'COMPENSATION_REFUND_PENDING';
/** `details.reason` of 409 `split_pay.checkout.order_not_open`. */
export type SplitOrderNotOpenReason = 'ORDER_NOT_OPEN' | 'METHOD_IN_PROGRESS' | 'WALLET_PAYMENT_IN_PROGRESS' | 'METHOD_PINNED' | 'ORDER_LOCKED';
/** `details.reason` of 410 `split_pay.resume.unavailable`. */
export type SplitResumeUnavailableReason = 'INVALID' | 'EXPIRED';
/** `details.reason` of 410 `split_pay.three_ds.restart_expired`. */
export type SplitThreeDsRestartExpiredReason = 'THREE_DS_CLOSED' | 'THREE_DS_SESSION_EXPIRED';

/**
 * How the Checkout Form opens a card leg's 3D Secure in a split payment
 * (panel: Form Settings → 3D Secure → 3D Secure display; set in the panel, not
 * through the API). INLINE (default): a window over the form, restarted once on
 * a separate page if the bank does not allow a window. REDIRECT: a separate
 * page; the remaining steps run on the hosted continuation page.
 */
export const ThreeDsDisplay: { readonly INLINE: 'INLINE'; readonly REDIRECT: 'REDIRECT' };
export type ThreeDsDisplayValue = (typeof ThreeDsDisplay)[keyof typeof ThreeDsDisplay];

/** `completion.outcome` and the `status` posted to your `callbackUrl` when a split payment concludes on the continuation page. */
export const SplitCompletionOutcome: { readonly SUCCESS: 'success'; readonly FAILURE: 'failure'; readonly PENDING: 'pending' };
export type SplitCompletionOutcomeValue = (typeof SplitCompletionOutcome)[keyof typeof SplitCompletionOutcome];

/**
 * Fields of the signed form POST (`application/x-www-form-urlencoded`) your
 * `callbackUrl` receives when a split payment concludes on the continuation
 * page. Same fields and signature as the single-card 3D Secure return.
 * Informational: confirm with the `payment.captured` webhook or `GET /payments/{paymentId}`.
 */
export interface SplitMerchantCallbackFields {
  /** The order's payment record (main payment); leg ids are not sent. */
  paymentId: string;
  /** Your order reference; only when set on the intent. */
  orderId?: string;
  status: SplitCompletionOutcomeValue;
  /** `'true'` only when `status` is `success`. */
  success: 'true' | 'false';
  /** The split payment status (e.g. `COMPLETED`, `VOIDED`). */
  code: SplitPaymentStatusValue | string;
  message: string;
  /** ISO 8601. */
  _timestamp: string;
  /** `v2=<hex>`. */
  _signature: string;
}

/** Result of a split payment that concluded on the continuation page. */
export interface SplitPaymentCompletion {
  outcome: SplitCompletionOutcomeValue;
  /** The split payment status. */
  code: SplitPaymentStatusValue | string;
  message: string;
  /** The order's payment record (main payment). */
  paymentId: string;
  orderId: string | null;
  /** The POST to your `callbackUrl`; null when the intent has no `callbackUrl` (the page shows the result). */
  merchantCallback: { url: string; method: 'POST'; fields: SplitMerchantCallbackFields } | null;
}

/** `details` of 400 `split_pay.refund.amount_exceeded`. */
export interface SplitRefundAmountExceededDetails {
  splitPaymentId: string;
  refundAmount: number;
  refundableAmount: number;
  nonRefundableAmount: number;
}

/** Body fields of `POST /payments/split`. */
export const SPLIT_PAYMENT_FIELDS: readonly string[];
/** Fields of one leg of `POST /payments/split`. */
export const SPLIT_PAYMENT_LEG_FIELDS: readonly string[];
/** Most legs of a split payment. */
export const SPLIT_MAX_LEGS: 5;

export interface SplitCardLegOptions {
  /** 3D Secure for this leg; the split's `callbackUrl` is then required. */
  force3D?: boolean;
  /** 1–36; from 2 upwards `installmentQuoteToken` is required. */
  installment?: number;
  /** Quote from `installmentOptions()` with this leg's amount (no intent). */
  installmentQuoteToken?: string;
}

export class SplitPaymentRequest {
  /** `totalAmount`: minor units, the sum of the leg amounts. `ownerRef`: your customer's card owner key. */
  constructor(totalAmount: number, currency: string, ownerRef: string);
  withOrderId(value: string): this;
  withCallbackUrl(value: string): this;
  /** A stored card of `ownerRef`. */
  addCardLeg(cardToken: string, amount: number, options?: SplitCardLegOptions): this;
  /**
   * A non-card leg with the `direct/payment` block. `providerCode` is required
   * (a provider with `splitEligible: true`). Promissory note: `noteCount` in
   * `fields`, no schedule.
   */
  addMethodLeg(paymentMethod: Exclude<PaymentMethodCode, 'CARD'> | string, providerCode: string, amount: number, fields?: MethodFields): this;
  /** Checks the body (`ConfigurationError`) and returns it. */
  toJSON(): JsonObject;
}

/** A step of a split payment, in the order the platform set. */
export interface SplitPaymentStep {
  legId: string;
  sequence: number;
  kind: SplitStepKindValue;
  paymentMethod: PaymentMethodCode | string;
  /** Non-card leg's provider; null for a card. */
  providerCode: string | null;
  splitBehavior: SplitBehaviorValue;
  /** Minor units. */
  amount: number | null;
  status: SplitLegStatusValue;
  /** Payment record of a non-card leg (`paymentId` of the action endpoints); null for a card or before it starts. */
  paymentId: string | null;
  /** This card replaces the card leg with this id (shortfall after a failed capture). */
  replacesLegId: string | null;
  /** The payment waits at this step. */
  current: boolean;
}

/** What the split payment waits for. */
export interface SplitPaymentPendingStep {
  legId: string;
  sequence: number;
  step: SplitPendingStepValue;
  paymentMethod: PaymentMethodCode | string;
  providerCode: string | null;
  amount: number | null;
  /** Non-card leg's payment record; null for a card. */
  paymentId: string | null;
  /** Open action (`step: ACTION`). */
  actionId: string | null;
  /** Card 3D Secure: where to send the buyer. */
  redirectPath: string | null;
  /** The action opened by this call, without secrets; null otherwise. */
  action: (PaymentAction & { status?: string }) | null;
}

/** A leg in the create / continue answer. */
export interface SplitPaymentLegSummary {
  id: string;
  sequence: number;
  legStatus: SplitLegStatusValue;
  paymentIntentId: string | null;
  paymentMethod?: PaymentMethodCode | string;
  splitBehavior?: SplitBehaviorValue;
  providerCode?: string | null;
  legAmount?: number;
  installmentCount?: number;
  replacesLegId?: string | null;
}

export interface SplitPaymentResult {
  splitPaymentId: string;
  /**
   * Checkout Form split answers only (`form/split/init`, `form/split/status`
   * and the continuation page): the main (checkout) payment's `paymentId`,
   * the id sent to your `callbackUrl`. Absent on `POST /payments/split`.
   */
  paymentId?: string;
  status: SplitPaymentStatusValue;
  /** The same Idempotency-Key was used before; no new payment was created. */
  duplicate: boolean;
  needsReconciliation: boolean;
  /** Another request is processing this split payment; read it again shortly. */
  lockContended: boolean;
  pendingLeg?: {
    id: string;
    sequence: number;
    paymentIntentId: string | null;
    redirectPath?: string;
    step?: SplitPendingStepValue;
    actionId?: string | null;
    paymentMethod?: string;
    providerCode?: string | null;
    legAmount?: number;
  };
  legs: SplitPaymentLegSummary[];
  steps: SplitPaymentStep[];
  pendingStep: SplitPaymentPendingStep | null;
  /** End of the payment window; null when there is none or the non-reversible leg has started. */
  expiresAt: string | null;
  /**
   * Checkout Form split answers only (form and continuation page): the
   * 3D Secure display the payment started with. Absent on `POST /payments/split`.
   */
  threeDsDisplay?: ThreeDsDisplayValue;
  /**
   * Continuation page answers only: the result once the split payment has
   * concluded, `null` while steps remain. Absent on `POST /payments/split`.
   */
  completion?: SplitPaymentCompletion | null;
}

export type SplitPaymentResponse = GatewayResponse<SplitPaymentResult>;

export interface SplitPaymentAggregate {
  totalAmount: number;
  legsAmount: number;
  amountsBalanced: boolean;
  legCount: number;
  capturedAmount: number;
  authorizedAmount: number;
  compensatedAmount: number;
  legStatusBreakdown: Array<{ status: SplitLegStatusValue; count: number; amount: number }>;
}

/** A leg in `getSplitPayment()`. The card token is never returned. */
export interface SplitPaymentLegDetail {
  id: string;
  sequence: number;
  legAmount: number;
  installmentCount: number;
  /** Leg amount plus the installment fee; null before the leg is charged. */
  chargeAmount: number | null;
  /** Refund ceiling of the leg; null before the leg is charged. */
  capturedAmount: number | null;
  refundedAmount: number | null;
  legStatus: SplitLegStatusValue;
  paymentMethod: PaymentMethodCode | string | null;
  providerCode: string | null;
  paymentIntentId: string | null;
  paymentIntentStatus: string | null;
  refundState: SplitLegRefundStateValue | null;
  compensationRefund: {
    status: 'PENDING' | 'COMPLETED';
    amount: number;
    attempt: number;
    requestedAt: string | null;
    nextAttemptAt: string | null;
    lastErrorCode: string | null;
    refundedAt: string | null;
  } | null;
  dispute: { state: string; disputedAmount: number; openChargebackCount: number } | null;
  cardTokenMasked: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  threeDRequired: boolean;
  failureReason: { normalizedCode: string | null; providerMessage: string | null; occurredAt: string | null } | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface SplitPaymentListItem {
  id: string;
  orderId: string | null;
  status: SplitPaymentStatusValue;
  currency: string;
  ownerScope: string;
  createdAt: string;
  updatedAt: string;
  aggregate: SplitPaymentAggregate;
  needsReconciliation: boolean;
}

export interface SplitPaymentDetail extends SplitPaymentListItem {
  ownerRef: string;
  legs: SplitPaymentLegDetail[];
  /** What can still be refunded from the main payment. */
  refund: { refundableAmount: number; nonRefundableAmount: number; refundedAmount: number };
  /** Chargebacks on the legs; the main payment's status does not change. */
  dispute: { hasDispute: boolean; disputedAmount: number; legCount: number };
  [key: string]: unknown;
}

export type SplitPaymentDetailResponse = GatewayResponse<SplitPaymentDetail>;

export interface ListSplitPaymentsFilters {
  status?: SplitPaymentStatusValue | SplitPaymentStatusValue[];
  currency?: string | string[];
  createdFrom?: string;
  createdTo?: string;
  orderId?: string;
  ownerRef?: string;
  /** 1–100, default 25. */
  limit?: number;
  /** `pageInfo.endCursor` of the previous page. */
  after?: string;
}

export type SplitPaymentListResponse = GatewayResponse<{
  items: SplitPaymentListItem[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: null;
}>;

export interface SplitRefundLegResult {
  legId: string;
  sequence: number;
  paymentIntentId: string;
  paymentMethod: PaymentMethodCode | string | null;
  providerCode: string | null;
  /** Minor units refunded from this leg in this request. */
  amount: number;
  status: SplitRefundLegStatusValue;
  errorCode: string | null;
}

export interface SplitRefundResult {
  refundRequestId: string;
  splitPaymentId: string;
  /** Checkout Form main payment; null for an API split payment. */
  parentPaymentId: string | null;
  orderId: string | null;
  currency: string;
  status: SplitRefundStatusValue;
  requestedAmount: number;
  refundedAmount: number;
  /** A completed request repeated with the same key; nothing was sent to the bank. */
  duplicate: boolean;
  legs: SplitRefundLegResult[];
  /** What is left to refund after this request. */
  refundableAmount: number;
  /** Amount of the non-reversible legs (never refunded). */
  nonRefundableAmount: number;
}

export type SplitRefundResponse = GatewayResponse<SplitRefundResult>;

/** `split` of a payment row (`list({ includeLegs })`, `get()`); absent or null for other payments. */
export interface PaymentSplitRef {
  splitPaymentId: string;
  role: PaymentSplitRoleValue;
  /** Checkout Form main payment of a leg; null otherwise. */
  parentPaymentId: string | null;
  /** Position of a leg; null on the main payment. */
  legSequence: number | null;
}

/** Filters of `payments.list()`. */
export interface ListPaymentsFilters {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
  /** Also return each split payment leg as its own row (default: one row per split payment). */
  includeLegs?: boolean;
}

/** One leg in the `legs[]` of a split payment's main result webhook (`payment.captured` / `payment.failed`, `settlementMode: 'SPLIT'`). */
export interface SplitEventLeg {
  legId: string;
  sequence: number;
  /** Minor units as a digit string. */
  amountMinor: string;
  legStatus: SplitLegStatusValue;
  paymentIntentId: string | null;
  paymentMethod?: PaymentMethodCode | string;
  providerCode?: string;
  refundState?: SplitLegRefundStateValue;
}

export class PaymentClient {
  createIntent(request: CreateIntentRequest | JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  createMarketplaceIntent(request: JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  capture(intentId: string, amount?: number | null, idempotencyKey?: string | null): Promise<JsonObject>;
  refund(intentId: string, amount?: number | null, reason?: string | null, idempotencyKey?: string | null): Promise<JsonObject>;
  void(intentId: string, idempotencyKey?: string | null): Promise<JsonObject>;
  /**
   * `POST /payments/direct/payment`, also the only server-side card charge
   * (`withCard`, `withForce3D(true)` for 3D Secure). `idempotencyKey` is
   * required. A declined payment throws `ValidationError` (HTTP 400). Without
   * `providerCode` on a `PLATFORM` method, 422 `payment.provider.none_eligible`
   * (`ApiError`, `details`: `ProviderNoneEligibleDetails`) means no connected
   * provider could take the payment; nothing was charged.
   */
  directMethodPayment(request: DirectMethodPaymentRequest | JsonObject, idempotencyKey: string): Promise<MethodPaymentResponse>;
  /** `POST /payments/{paymentId}/actions/{actionId}/confirm`. A rejected code throws `ApiError` (HTTP 422, `details.attemptsRemaining`). */
  confirmPaymentAction(paymentId: string, actionId: string, input: PaymentActionConfirmInput): Promise<MethodPaymentResponse>;
  /** `POST /payments/{paymentId}/actions/{actionId}/resend`. Confirm with the new `data.action.id`. */
  resendPaymentAction(paymentId: string, actionId: string): Promise<MethodPaymentResponse>;
  /** `GET /payments/methods`; `{ paymentMethod }` adds `?paymentMethod=` (400 `payment.method.unknown` for an unknown code). */
  listPaymentMethods(options?: ListPaymentMethodsOptions): Promise<PaymentMethodListResponse>;
  /** `GET /payments/methods`. */
  listPaymentMethods(): Promise<PaymentMethodListResponse>;
  /** `GET /payments/{paymentId}/promissory-notes` (signed). 404 `payment.promissory_note.not_found` when the payment has no notes. */
  getPromissoryNotes(paymentId: string): Promise<PromissoryNotesResponse>;
  /**
   * `POST /payments/{paymentId}/promissory-notes/cancel` (signed). Without
   * `serialNumbers` every open note is cancelled; the result is per note in
   * `cancelResults`. The payment stays `CAPTURED`.
   */
  cancelPromissoryNotes(paymentId: string, serialNumbers?: string[] | null, idempotencyKey?: string | null): Promise<PromissoryNotesResponse>;
  /** `GET /payments/{paymentId}/promissory-notes/document` (signed): the printable notes, `contentType` `application/pdf`. */
  downloadPromissoryNoteDocument(paymentId: string, locale?: PromissoryNoteDocumentLocaleValue | null): Promise<BinaryResponse>;
  binInfo(binOrPan: string): Promise<JsonObject>;
  installmentOptions(request: InstallmentOptionsRequest | JsonObject): Promise<JsonObject>;
  cardTaxonomy(): Promise<JsonObject>;
  storeCard(request: StoreCardRequest | JsonObject, idempotencyKey?: string | null): Promise<JsonObject>;
  listStoredCards(cardUserKey: string): Promise<JsonObject>;
  getStoredCard(storedCardToken: string): Promise<JsonObject>;
  deactivateStoredCard(storedCardToken: string, idempotencyKey?: string | null): Promise<JsonObject>;
  get(intentId: string): Promise<JsonObject>;
  /** `GET /payments`; `includeLegs: true` also returns split payment legs as rows (`split.role` `LEG`). */
  list(filters?: ListPaymentsFilters | JsonObject): Promise<JsonObject>;
  /**
   * `POST /payments/split` (signed, `idempotencyKey` required). Continue after
   * a step with the same request and the same key. A running payment's answer
   * (HTTP 400 with the status as `code`) is returned, not thrown; a failed one
   * throws `ValidationError` (`response.data` carries the split).
   */
  createSplitPayment(request: SplitPaymentRequest | JsonObject, idempotencyKey: string): Promise<SplitPaymentResponse>;
  /** `GET /payments/split/{splitPaymentId}`. */
  getSplitPayment(splitPaymentId: string): Promise<SplitPaymentDetailResponse>;
  /** `GET /payments/split`; a list filter is sent as repeated parameters. */
  listSplitPayments(filters?: ListSplitPaymentsFilters): Promise<SplitPaymentListResponse>;
  /**
   * `POST /payments/split/{splitPaymentId}/refund` (signed, `idempotencyKey`
   * required). Incomplete: throws `ValidationError` with code
   * `split_pay.refund.incomplete` and the per-leg result in `response.data`.
   */
  refundSplitPayment(splitPaymentId: string, amount: number, reason?: string | null, idempotencyKey?: string | null): Promise<SplitRefundResponse>;
  failoverRecoveryAnalytics(filters?: JsonObject): Promise<JsonObject>;
  providerCredentialAnalytics(credentialId: string, filters?: JsonObject): Promise<JsonObject>;
}

// ───────────────────────────── Reference data ─────────────────────────────

export interface AddressReferenceItem {
  code: string;
  name: string;
}

export type AddressReferenceResponse = GatewayResponse<{ items: AddressReferenceItem[] }>;

/** Türkiye address codes (Lunixi) for `ADDRESS` fields. An empty list: that level is not published yet. */
export class ReferenceClient {
  /** `GET /reference/tr-address/provinces` (codes `01`–`81`). */
  listProvinces(): Promise<AddressReferenceResponse>;
  /** `GET /reference/tr-address/districts?provinceCode=…`. */
  listDistricts(provinceCode: string): Promise<AddressReferenceResponse>;
  /** `GET /reference/tr-address/neighborhoods?districtCode=…`. */
  listNeighborhoods(districtCode: string): Promise<AddressReferenceResponse>;
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

// ───────────────────────────── Bank accounts ─────────────────────────────

export const BankConnectionStatus: {
  readonly PENDING_DOCUMENTS: 'PENDING_DOCUMENTS';
  readonly UNDER_REVIEW: 'UNDER_REVIEW';
  readonly PENDING_SETUP: 'PENDING_SETUP';
  readonly ACTIVE: 'ACTIVE';
  readonly DEGRADED: 'DEGRADED';
  readonly SUSPENDED: 'SUSPENDED';
  readonly DISCONNECTED: 'DISCONNECTED';
};
export type BankConnectionStatusValue = (typeof BankConnectionStatus)[keyof typeof BankConnectionStatus];

export const BankAccountStatus: { readonly ACTIVE: 'ACTIVE'; readonly INACTIVE: 'INACTIVE' };
export type BankAccountStatusValue = (typeof BankAccountStatus)[keyof typeof BankAccountStatus];

export const BankTransactionDirection: { readonly CREDIT: 'CREDIT'; readonly DEBIT: 'DEBIT' };
export type BankTransactionDirectionValue = (typeof BankTransactionDirection)[keyof typeof BankTransactionDirection];

export const BankTransactionType: {
  readonly TRANSFER_IN: 'TRANSFER_IN';
  readonly TRANSFER_OUT: 'TRANSFER_OUT';
  readonly INTERNAL_IN: 'INTERNAL_IN';
  readonly INTERNAL_OUT: 'INTERNAL_OUT';
  readonly POS_SETTLEMENT: 'POS_SETTLEMENT';
  readonly POS_SETTLEMENT_REFUND: 'POS_SETTLEMENT_REFUND';
  readonly FEE: 'FEE';
  readonly TAX: 'TAX';
  readonly CASH_IN: 'CASH_IN';
  readonly CASH_OUT: 'CASH_OUT';
  readonly CARD: 'CARD';
  readonly LOAN: 'LOAN';
  readonly FX: 'FX';
  readonly INTEREST: 'INTEREST';
  readonly OTHER: 'OTHER';
};
export type BankTransactionTypeValue = (typeof BankTransactionType)[keyof typeof BankTransactionType];

export const BankAvailability: { readonly AVAILABLE: 'AVAILABLE'; readonly COMING_SOON: 'COMING_SOON' };
export type BankAvailabilityValue = (typeof BankAvailability)[keyof typeof BankAvailability];

/** OUTGOING_TRANSFER / FX_EXCHANGE: the connection can send transfers / exchange currency. */
export const BankCapability: {
  readonly ACCOUNT_LIST: 'ACCOUNT_LIST';
  readonly BALANCE: 'BALANCE';
  readonly TRANSACTIONS: 'TRANSACTIONS';
  readonly OUTGOING_TRANSFER: 'OUTGOING_TRANSFER';
  readonly FX_EXCHANGE: 'FX_EXCHANGE';
};
export type BankCapabilityValue = (typeof BankCapability)[keyof typeof BankCapability];

export const BankSyncStatus: { readonly QUEUED: 'QUEUED'; readonly SCHEDULED: 'SCHEDULED' };
export type BankSyncStatusValue = (typeof BankSyncStatus)[keyof typeof BankSyncStatus];

/** Bank-account webhook event types deliverable to a merchant endpoint. */
export const BankConnectEvents: { readonly TRANSACTION_RECEIVED: 'bank_account.transaction.received' };
export type BankConnectEventType = (typeof BankConnectEvents)[keyof typeof BankConnectEvents];
export const BANK_CONNECT_EVENT_TYPES: readonly BankConnectEventType[];
/** Subscription pattern covering every bank-account event. */
export const BANK_CONNECT_EVENT_PATTERN: 'bank_account.*';

/** Query filters each list call accepts; any other is refused before sending. */
export const BANK_CONNECT_FILTERS: {
  readonly listBanks: readonly string[];
  readonly listConnections: readonly string[];
  readonly listAccounts: readonly string[];
  readonly listBalances: readonly string[];
  readonly listTransactions: readonly string[];
};

/** The bank a connection, an account or a transaction belongs to. */
export interface BankRef {
  bankId: string;
  /** 4-digit EFT code. */
  eftCode: string;
  name?: string;
}

/** A row of the bank catalogue. A field without a value is left out. */
export interface BankConnectBank {
  bankId: string;
  eftCode: string;
  name: string;
  shortName?: string;
  bic?: string;
  country?: string;
  availability: BankAvailabilityValue;
  /** Empty when the bank is COMING_SOON. */
  capabilities: BankCapabilityValue[];
}

export interface BankConnection {
  connectionId: string;
  bank: BankRef;
  status: BankConnectionStatusValue;
  /** Short snake_case reason of the status, e.g. `activated`. */
  statusReasonCode?: string;
  createdAt?: string;
  activatedAt?: string;
  lastSuccessfulSyncAt?: string;
  accountCount: number;
  /** What this connection offers; OUTGOING_TRANSFER / FX_EXCHANGE enable `transfers` / `fx`. */
  capabilities: BankCapabilityValue[];
}

/** How current an account's data is: at most one read from the bank per `minSyncIntervalSeconds`. */
export interface BankAccountFreshness {
  lastSuccessfulSyncAt?: string;
  nextSyncAvailableAt?: string;
  minSyncIntervalSeconds: number;
}

export interface BankAccount {
  accountId: string;
  connectionId: string;
  bank: BankRef;
  /** e.g. `TR00 **** **** **** **** **00 00`; the full IBAN is never returned. */
  ibanMasked?: string;
  accountNumberMasked?: string;
  currency: string;
  branchCode?: string;
  branchName?: string;
  /** The bank's product code of the account, e.g. `CARIHSP`. */
  productCode?: string;
  status: BankAccountStatusValue;
  discoveredAt?: string;
  freshness: BankAccountFreshness;
  /** The account name the bank shows. */
  displayName?: string;
  /** The bank's account type text. */
  accountType?: string;
}

/** Latest balance of an account. Integers in minor units; left out when the bank does not report them. */
export interface BankBalance {
  accountId: string;
  currency: string;
  balanceMinor: number;
  availableMinor?: number;
  blockedMinor?: number;
  asOf?: string;
  /** Available balance excluding the overdraft line (when the bank reports it separately). */
  availableWithoutOverdraftMinor?: number;
  /** Unused overdraft line (when the bank reports it). */
  overdraftAvailableMinor?: number;
}

/** A row of the transaction list. `amountMinor` is positive; `direction` gives the sign. */
export interface BankTransaction {
  transactionId: string;
  accountId: string;
  direction: BankTransactionDirectionValue;
  amountMinor: number;
  currency: string;
  bookedAt?: string;
  valueAt?: string;
  canonicalType: BankTransactionTypeValue;
  /** The bank's text as received. */
  description?: string;
  counterpartyNameMasked?: string;
  counterpartyIbanMasked?: string;
  receiptNo?: string;
  /** When Lunixi recorded it; lists are ordered by it, newest first. */
  receivedAt?: string;
  /** Present (true) only when the row reverses an earlier transaction. */
  isReversal?: boolean;
  /** The reversed transaction, when the bank links it. */
  reversalOfTransactionId?: string;
  /** Counterparty bank's EFT code and name, when the bank reports them. */
  counterpartyBankCode?: string;
  counterpartyBankName?: string;
}

/** `getTransaction()`: the row plus the detail fields. */
export interface BankTransactionDetail extends BankTransaction {
  balanceAfterMinor?: number;
  documentNo?: string;
  bank: BankRef;
}

/** Answer of `requestSync()` (HTTP 202). */
export interface BankSyncRequest {
  accountId: string;
  syncStatus: BankSyncStatusValue;
  /** SCHEDULED: when the read runs. */
  scheduledAt?: string;
  lastSuccessfulSyncAt?: string;
  minSyncIntervalSeconds: number;
}

/** The `data` of a `bank_account.transaction.received` webhook. Values the bank did not send are `null`. */
export interface BankAccountTransactionReceivedData {
  transactionId: string;
  accountId: string;
  connectionId: string;
  bankEftCode: string;
  bankName: string;
  direction: BankTransactionDirectionValue;
  amountMinor: number;
  currency: string;
  bookedAt: string;
  valueAt: string | null;
  receivedAt: string;
  canonicalType: BankTransactionTypeValue;
  description: string | null;
  counterpartyNameMasked: string | null;
  counterpartyIbanMasked: string | null;
  receiptNo: string | null;
}

export interface BankConnectPage<T> {
  items: T[];
  hasMore: boolean;
  /** Opaque — pass back verbatim as `cursor`. */
  nextCursor: string | null;
}

export interface BankConnectPageFilters {
  /** 1–100 (default 25). */
  limit?: number;
  cursor?: string;
}

export interface BankConnectionFilters extends BankConnectPageFilters {
  status?: BankConnectionStatusValue | BankConnectionStatusValue[];
  bankId?: string;
}

export interface BankAccountFilters extends BankConnectPageFilters {
  connectionId?: string;
  bankId?: string;
  /** ISO 4217. */
  currency?: string;
  status?: BankAccountStatusValue;
}

export interface BankBalanceFilters extends BankConnectPageFilters {
  /** Up to 100 account ids; none = every active account of the key's environment. */
  accountId?: string | string[];
  currency?: string;
}

export interface BankTransactionFilters extends BankConnectPageFilters {
  /** Up to 100 account ids; none = every account of the key's environment. */
  accountId?: string | string[];
  /** Bank date, inclusive. ISO-8601 with a time zone. */
  bookedFrom?: string | Date;
  /** Bank date, exclusive; needs `bookedFrom`, at most 92 days after it. */
  bookedTo?: string | Date;
  direction?: BankTransactionDirectionValue;
  /** Minor units, inclusive. */
  minAmountMinor?: number;
  maxAmountMinor?: number;
  canonicalType?: BankTransactionTypeValue | BankTransactionTypeValue[];
}

// ───────────────────────── Bank transfers and exchange ─────────────────────────

export const BankTransferStatus: {
  readonly PENDING_OTP: 'PENDING_OTP';
  readonly SUBMITTED: 'SUBMITTED';
  readonly PROCESSING: 'PROCESSING';
  readonly COMPLETED: 'COMPLETED';
  readonly FAILED: 'FAILED';
  readonly RETURNED: 'RETURNED';
  readonly CANCELED: 'CANCELED';
};
export type BankTransferStatusValue = (typeof BankTransferStatus)[keyof typeof BankTransferStatus];

export const BankTransferRail: {
  readonly INTERNAL: 'INTERNAL';
  readonly INTRABANK: 'INTRABANK';
  readonly FAST: 'FAST';
  readonly EFT: 'EFT';
  readonly UNKNOWN: 'UNKNOWN';
};
export type BankTransferRailValue = (typeof BankTransferRail)[keyof typeof BankTransferRail];

export const BankTransferInitiatedVia: { readonly PANEL: 'PANEL'; readonly API: 'API' };
export type BankTransferInitiatedViaValue = (typeof BankTransferInitiatedVia)[keyof typeof BankTransferInitiatedVia];

export const BankFxOrderStatus: { readonly SUBMITTED: 'SUBMITTED'; readonly COMPLETED: 'COMPLETED'; readonly FAILED: 'FAILED' };
export type BankFxOrderStatusValue = (typeof BankFxOrderStatus)[keyof typeof BankFxOrderStatus];

export const BankFxRequestedSide: { readonly SOURCE: 'SOURCE'; readonly TARGET: 'TARGET' };
export type BankFxRequestedSideValue = (typeof BankFxRequestedSide)[keyof typeof BankFxRequestedSide];

/** Transfer webhook event types deliverable to a merchant endpoint. */
export const BankTransferEvents: {
  readonly CREATED: 'bank_transfer.created';
  readonly COMPLETED: 'bank_transfer.completed';
  readonly FAILED: 'bank_transfer.failed';
  readonly RETURNED: 'bank_transfer.returned';
};
export type BankTransferEventType = (typeof BankTransferEvents)[keyof typeof BankTransferEvents];
export const BANK_TRANSFER_EVENT_TYPES: readonly BankTransferEventType[];
/** Subscription pattern covering every transfer event. */
export const BANK_TRANSFER_EVENT_PATTERN: 'bank_transfer.*';

export interface BankTransferRoute {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly idempotencyKey: boolean;
  readonly required?: readonly string[];
  readonly optional?: readonly string[];
  readonly query?: readonly string[];
}
/** Transfer and exchange routes: method, path, body and query fields, Idempotency-Key rule. */
export const BANK_TRANSFER_ROUTES: Readonly<Record<
  'listTransferPurposes' | 'createTransfer' | 'listTransfers' | 'getTransfer' | 'listFxRates'
  | 'createFxQuote' | 'createFxOrder' | 'listFxOrders' | 'getFxOrder',
  BankTransferRoute
>>;

/** An outgoing transfer. Unlike the read routes, a field without a value is `null`. */
export interface BankTransfer {
  id: string;
  connectionId: string;
  accountId: string;
  /** `test` or `live`. */
  environment: string;
  status: BankTransferStatusValue;
  rail: BankTransferRailValue | null;
  amountMinor: number;
  currency: string;
  sourceIbanMasked: string | null;
  receiverIbanMasked: string;
  receiverNameMasked: string;
  receiverBankCode: string | null;
  paymentPurpose: string | null;
  description: string | null;
  idempotencyKey: string;
  /** `bank_connect.transfer.*` code when FAILED, RETURNED or CANCELED. */
  failureCode: string | null;
  /** The bank's answer could not be confirmed; Lunixi is checking it. */
  outcomeUnknown: boolean;
  initiatedVia: BankTransferInitiatedViaValue;
  /** `NOT_SCREENED`, `CLEAR`, `POTENTIAL_MATCH` or `ERROR`; informational. */
  sanctionStatus: string;
  /** The outgoing transaction on the account once it is matched (see `getTransaction()`). */
  bankTransactionId: string | null;
  /** The bank's own status text of the transfer. */
  bankState: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  returnedAt: string | null;
  canceledAt: string | null;
  /** Dashboard transfers waiting for the e-mail code: when the code expires. */
  otpExpiresAt: string | null;
}

export interface BankTransferRequest {
  /** Source account (its connection offers OUTGOING_TRANSFER). */
  accountId: string;
  /** TR IBAN, checked with mod-97 by the service. */
  receiverIban: string;
  /** 2–140 characters. */
  receiverName: string;
  /** Integer > 0, minor units (150075 = 1,500.75 TRY). */
  amountMinor: number;
  /** ISO 4217; default TRY. */
  currency?: string;
  /** A code from `transfers.listPurposes()`; none = the bank's default. */
  paymentPurpose?: string;
  /** At most 140 characters. */
  description?: string;
}

export interface BankTransferCreated {
  transfer: BankTransfer;
  /** Always null for API-key calls (no e-mail code). */
  stepUp: { challengeId: string; expiresAt: string | null; channel: string } | null;
  /** True when the same Idempotency-Key and body answered an existing transfer. */
  replayed: boolean;
}

export interface BankTransferPurpose {
  code: string;
  name: string;
  order: number;
}

export interface BankTransferFilters extends BankConnectPageFilters {
  accountId?: string;
  status?: BankTransferStatusValue | BankTransferStatusValue[];
  /** Inclusive. */
  createdFrom?: string | Date;
  /** Exclusive. */
  createdTo?: string | Date;
}

export interface BankFxRate {
  currency: string;
  pairCurrency: string;
  /** Decimal strings, as the bank sends them. */
  buyRate: string;
  sellRate: string;
  spread: string | null;
  updatedAt: string | null;
}

export interface BankFxRates {
  items: BankFxRate[];
  refreshSeconds: number;
  fetchedAt: string | null;
}

export interface BankFxQuoteRequest {
  /** You sell from this account. */
  sourceAccountId: string;
  /** You buy into this account (same connection, another currency). */
  targetAccountId: string;
  /** Exactly one of the two amounts, minor units of that account's currency. */
  sourceAmountMinor?: number;
  targetAmountMinor?: number;
}

export interface BankFxQuote {
  id: string;
  connectionId: string;
  sourceAccountId: string;
  targetAccountId: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmountMinor: number;
  targetAmountMinor: number;
  requestedSide: BankFxRequestedSideValue;
  /** Decimal string. */
  appliedRate: string;
  taxAmountMinor: number | null;
  /** Use the quote before this time. */
  expiresAt: string | null;
  validForSeconds: number;
  insufficientBalance: boolean;
  belowMinimum: boolean;
  createdAt: string | null;
}

export interface BankFxOrderRequest {
  quoteId: string;
  /** At most 140 characters. */
  description?: string;
}

export interface BankFxOrder {
  id: string;
  quoteId: string;
  connectionId: string;
  sourceAccountId: string;
  targetAccountId: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmountMinor: number;
  targetAmountMinor: number;
  appliedRate: string;
  description: string | null;
  idempotencyKey: string;
  status: BankFxOrderStatusValue;
  /** `bank_connect.fx.*` code when FAILED. */
  failureCode: string | null;
  outcomeUnknown: boolean;
  initiatedVia: BankTransferInitiatedViaValue;
  sourceBalanceAfterMinor: number | null;
  targetBalanceAfterMinor: number | null;
  createdAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  /** Dashboard orders only. */
  fxSessionId: string | null;
}

export interface BankFxOrderCreated {
  order: BankFxOrder;
  replayed: boolean;
}

export interface BankFxOrderFilters extends BankConnectPageFilters {
  status?: BankFxOrderStatusValue | BankFxOrderStatusValue[];
}

/** The `data` of a `bank_transfer.*` webhook. Values without a value are `null`. */
export interface BankTransferWebhookData {
  transferId: string;
  connectionId: string;
  accountId: string;
  bankEftCode: string;
  bankName: string;
  status: BankTransferStatusValue;
  rail: BankTransferRailValue | null;
  amountMinor: number;
  currency: string;
  receiverIbanMasked: string;
  receiverNameMasked: string;
  paymentPurpose: string | null;
  description: string | null;
  failureCode: string | null;
  idempotencyKey: string;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
  returnedAt: string | null;
}

/**
 * Outgoing transfers — `client.bankConnect.transfers`. Every call is signed and
 * needs `bank-connect:transfer` and a key with an IP allowlist.
 */
export class BankTransferClient {
  constructor(api: ApiClient);
  listPurposes(connectionId: string): Promise<{ items: BankTransferPurpose[] }>;
  /** HTTP 201. `idempotencyKey` is generated when omitted. */
  create(request: BankTransferRequest, idempotencyKey?: string): Promise<BankTransferCreated>;
  list(filters?: BankTransferFilters): Promise<BankConnectPage<BankTransfer>>;
  iterate(filters?: BankTransferFilters): AsyncGenerator<BankTransfer, void, void>;
  get(transferId: string): Promise<BankTransfer>;
}

/**
 * Currency exchange between two of your accounts — `client.bankConnect.fx`.
 * Same scope and IP allowlist rule as transfers.
 */
export class BankFxClient {
  constructor(api: ApiClient);
  listRates(connectionId: string): Promise<BankFxRates>;
  /** HTTP 201. */
  createQuote(request: BankFxQuoteRequest): Promise<BankFxQuote>;
  /** HTTP 201. `idempotencyKey` is generated when omitted. */
  createOrder(request: BankFxOrderRequest, idempotencyKey?: string): Promise<BankFxOrderCreated>;
  listOrders(filters?: BankFxOrderFilters): Promise<BankConnectPage<BankFxOrder>>;
  iterateOrders(filters?: BankFxOrderFilters): AsyncGenerator<BankFxOrder, void, void>;
  getOrder(orderId: string): Promise<BankFxOrder>;
}

/**
 * Bank accounts — `client.bankConnect`. Every call is signed. Scopes:
 * `bank-connect:view` (banks, connections, accounts, requestSync),
 * `bank-connect:transactions:view` (balances, transactions) and
 * `bank-connect:transfer` (`transfers`, `fx`).
 */
export class BankConnectClient {
  constructor(api: ApiClient);
  readonly transfers: BankTransferClient;
  readonly fx: BankFxClient;
  listBanks(filters?: BankConnectPageFilters): Promise<BankConnectPage<BankConnectBank>>;
  iterateBanks(filters?: BankConnectPageFilters): AsyncGenerator<BankConnectBank, void, void>;
  listConnections(filters?: BankConnectionFilters): Promise<BankConnectPage<BankConnection>>;
  iterateConnections(filters?: BankConnectionFilters): AsyncGenerator<BankConnection, void, void>;
  getConnection(connectionId: string): Promise<BankConnection>;
  listAccounts(filters?: BankAccountFilters): Promise<BankConnectPage<BankAccount>>;
  iterateAccounts(filters?: BankAccountFilters): AsyncGenerator<BankAccount, void, void>;
  getAccount(accountId: string): Promise<BankAccount>;
  /** HTTP 202; 409 `bank_connect.connection.not_active`; 429 `RATE_LIMITED` as a `RateLimitError`. */
  requestSync(accountId: string): Promise<BankSyncRequest>;
  listBalances(filters?: BankBalanceFilters): Promise<BankConnectPage<BankBalance>>;
  iterateBalances(filters?: BankBalanceFilters): AsyncGenerator<BankBalance, void, void>;
  listTransactions(filters?: BankTransactionFilters): Promise<BankConnectPage<BankTransaction>>;
  iterateTransactions(filters?: BankTransactionFilters): AsyncGenerator<BankTransaction, void, void>;
  getTransaction(transactionId: string): Promise<BankTransactionDetail>;
}

// ── Sanctions screening ─────────────────────────────────────────────────────

export const SanctionRiskDomain: {
  readonly SANCTIONS: 'sanctions';
  readonly PEP: 'pep';
  readonly RCA: 'rca';
  readonly WANTED: 'wanted';
  readonly REGULATORY: 'regulatory';
  readonly DEBARMENT: 'debarment';
  readonly OWNERSHIP: 'ownership';
  readonly VESSEL: 'vessel';
  readonly SECURITIES: 'securities';
};
export type SanctionRiskDomainValue = (typeof SanctionRiskDomain)[keyof typeof SanctionRiskDomain];

export const SanctionScreenMode: {
  readonly SANCTIONS_ONLY: 'sanctions_only';
  readonly SANCTIONS_PEP: 'sanctions_pep';
  readonly FULL_RISK: 'full_risk';
};
export type SanctionScreenModeValue = (typeof SanctionScreenMode)[keyof typeof SanctionScreenMode];

export const SanctionWalletScreenMode: {
  readonly WALLET_SANCTIONS: 'wallet_sanctions';
  readonly WALLET_RISK: 'wallet_risk';
  readonly WALLET_FULL_AML: 'wallet_full_aml';
};
export type SanctionWalletScreenModeValue = (typeof SanctionWalletScreenMode)[keyof typeof SanctionWalletScreenMode];

export const SanctionSubjectType: { readonly PERSON: 'person'; readonly ORGANIZATION: 'organization' };
export type SanctionSubjectTypeValue = (typeof SanctionSubjectType)[keyof typeof SanctionSubjectType];

export const SanctionCoverageStatus: { readonly COMPLETE: 'COMPLETE'; readonly PARTIAL: 'PARTIAL'; readonly DEGRADED: 'DEGRADED' };
export type SanctionCoverageStatusValue = (typeof SanctionCoverageStatus)[keyof typeof SanctionCoverageStatus];

export const SanctionHitType: { readonly EXACT: 'exact'; readonly PROBABLE: 'probable'; readonly POSSIBLE: 'possible' };
export type SanctionHitTypeValue = (typeof SanctionHitType)[keyof typeof SanctionHitType];

export interface SanctionRoute {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  /** A screening: an answer that is not `status: "success"` throws instead of being read. */
  readonly screening: boolean;
  readonly required?: readonly string[];
  readonly optional?: readonly string[];
  /** At least one of these body fields must be present. */
  readonly anyOf?: readonly string[];
  readonly query?: readonly string[];
}
/** API-key sanction routes: method, path, body and query fields. Single source for the PHP SDK and Postman. */
export const SANCTION_ROUTES: Readonly<Record<
  'screenName' | 'screenWallet' | 'screenAccount' | 'screenTransaction' | 'screenPublicProcurementBan'
  | 'screenAdverseMedia' | 'evaluateBehavioralAlert' | 'listScreeningHistory' | 'registerMonitoring'
  | 'listMonitoringAlerts' | 'listMonitoredEntities' | 'listMonitoringMatches' | 'getDatasetFreshness'
  | 'searchEntities' | 'getEntityProfile' | 'getEntityGraph' | 'getIndirectExposure'
  | 'getOwnershipAggregation' | 'listBlacklistEntries',
  SanctionRoute
>>;

/**
 * True only when the screening found nothing and, when it reports coverage,
 * `coverageStatus` is `COMPLETE`. `PARTIAL`, `DEGRADED` or a `null` coverage is
 * never clear.
 */
export function isClearScreening(result: object | null | undefined): boolean;

/** Fields shared by the screenings that read the active list publication. */
export interface SanctionPublicationEvidence {
  /** `null` on a replay of a screening made before list publications. */
  publicationId: string | null;
  publicationRevision: number | null;
  coverageStatus: SanctionCoverageStatusValue | null;
  /** Id of the screening's immutable evidence record. */
  evidenceRef: string | null;
}

export interface SanctionIdentifierInput {
  /** e.g. `passport`, `national_id`, `tax_id`, `mersis_no`. */
  type: string;
  value: string;
}

export interface SanctionScreenNameRequest {
  name: string;
  subjectType?: SanctionSubjectTypeValue;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  /** ISO-8601 date. */
  dateOfBirth?: string;
  identifiers?: SanctionIdentifierInput[];
  /** Narrows the screening; omitted means every risk domain. */
  riskDomains?: SanctionRiskDomainValue[];
  mode?: SanctionScreenModeValue;
  /** Minimum match score, 0–1 (a value above 1 is read as a percentage). */
  threshold?: number;
  customerReference?: string;
}

export interface SanctionListing {
  subList: string;
  label: string;
  program: string;
  reference: string;
  listedOn: string;
}

/** One list a (merged) match appears on. */
export interface SanctionMatchList {
  datasetCode: string;
  displayName: string;
  datasetKind: string;
  /** The list version the screening read. */
  datasetVersionId: string;
  subLists: string[];
  programs: string[];
  /** Records of this list merged into the match. */
  entityIds: string[];
  listings: SanctionListing[];
}

export interface SanctionMatch {
  hitId: string;
  entityId: string;
  matchedName: string;
  /** 0–1. */
  score: number;
  hitType: SanctionHitTypeValue | string;
  listCode: string;
  /** The list of the match's representative record; `lists` has all of them. */
  sourceListName: string;
  recordType: string;
  riskDomains: string[];
  reason: string;
  explanationJson: string;
  explanation: unknown;
  lists: SanctionMatchList[];
}

export interface SanctionScreenNameResult extends SanctionPublicationEvidence {
  latencyMs: number;
  /** The screening's id (history, report). The envelope's `requestId` is the HTTP request's. */
  screeningRequestId: string | null;
  screenedRiskDomains: string[];
  uncoveredRiskDomains: string[];
  matches: SanctionMatch[];
  /** Which vintage of data was screened; empty when the manifest could not be produced. */
  datasetFreshnessJson: string;
}

export interface SanctionScreenWalletRequest {
  walletAddress: string;
  chain?: string;
  mode?: SanctionWalletScreenModeValue;
  customerReference?: string;
}

/** A listed party in the active publication that holds the address. */
export interface SanctionWalletPublicationHit {
  hitId: string;
  entityId: string;
  entityName: string;
  entityType: string;
  hitType: string;
  /** 100 for the sanctions domain, 90 for any other. */
  score: number;
  riskCategory: string;
  riskDomains: string[];
  sourceListName: string;
  lists: SanctionMatchList[];
  entityIds: string[];
  listedAddress: string;
  listedChains: string[];
  caseRule: 'EVM_HEX' | 'BECH32' | 'CASHADDR' | 'CASE_SENSITIVE' | string;
}

/** Your own wallet list, exposure records and crypto intelligence; never list-publication hits. */
export interface SanctionWalletHit {
  hitId: string;
  hitType: string;
  riskCategory: string;
  score: number;
  hopDistance: number;
  taintPercentage: number;
  explanationJson: string;
  explanation: unknown;
}

export interface SanctionScreenWalletResult extends SanctionPublicationEvidence {
  address: string;
  chain: string;
  isSanctioned: boolean;
  riskScore: number;
  riskLevel: string;
  latencyMs: number;
  publicationHits: SanctionWalletPublicationHit[];
  hits: SanctionWalletHit[];
}

export interface SanctionScreenAccountRequest {
  accountValue: string;
  /** `iban`, `local_account`, `emoney_wallet`, `fast_alias`. */
  accountScheme: string;
  providerCode?: string;
  productChannel?: string;
  customerReference?: string;
}

export interface SanctionScreenAccountResult {
  normalizedValue: string;
  accountScheme: string;
  isSanctioned: boolean;
  isBlacklisted: boolean;
  riskScore: number;
  riskLevel: string;
  latencyMs: number;
  hits: Array<{ accountId: string; hitType: string; riskScore: number; labelsJson: string; labels: unknown; blacklistReason: string; fraudReportCount: number }>;
}

export interface SanctionTransactionParty {
  name: string;
  role?: string;
  subjectType?: SanctionSubjectTypeValue;
  countryCode?: string;
  customerId?: string;
  dateOfBirth?: string;
  nationalId?: string;
}

export interface SanctionTransactionAccount {
  /** `iban`, `local_account`, `emoney_wallet`, `crypto_wallet`. */
  accountType: string;
  value: string;
  role?: string;
  providerCode?: string;
  chain?: string;
}

/** At least one party or account. */
export interface SanctionScreenTransactionRequest {
  transactionType?: string;
  direction?: string;
  amount?: number;
  currency?: string;
  channel?: string;
  occurredAt?: string;
  parties?: SanctionTransactionParty[];
  accounts?: SanctionTransactionAccount[];
  metadataJson?: string;
}

export interface SanctionScreenTransactionResult {
  decision: string;
  riskScore: number;
  action: string;
  resultsJson: string;
  /** Per-party evidence, coverage and list detail. */
  results: unknown;
  explanations: string[];
  caseRequired: boolean;
  latencyMs: number;
  publicationId: string;
  publicationRevision: number;
  /** The weakest coverage among the parties; empty when no party was screened. */
  coverageStatus: SanctionCoverageStatusValue | '';
}

/** At least one of `entityName`, `tckn`, `vkn`. */
export interface SanctionScreenProcurementBanRequest {
  entityName?: string;
  tckn?: string;
  vkn?: string;
  entityType?: string;
  onlyActive?: boolean;
  limit?: number;
  customerReference?: string;
  productChannel?: string;
}

export interface SanctionProcurementBanHit {
  hitId: string;
  hitType: string;
  eventId: string;
  entityType: string;
  entityName: string;
  decisionType: string;
  decisionNumber: string;
  banScope: string;
  banReason: string;
  banStartDate: string;
  banEndDate: string;
  activeBan: boolean;
  /** `tckn` | `vkn` | `identifier` | `normalized_name` | `name_fuzzy`. */
  matchBasis: string;
  riskScore: number;
  sourceListName: string;
  lists: SanctionMatchList[];
  entityIds: string[];
}

export interface SanctionScreenProcurementBanResult extends SanctionPublicationEvidence {
  matched: boolean;
  riskScore: number;
  decision: string;
  latencyMs: number;
  hits: SanctionProcurementBanHit[];
  screenedRiskDomains: string[];
  /** The debarment lists the screening read. */
  searchedLists: Array<{ datasetCode: string; displayName: string; datasetVersionId: string }>;
  /** Sources expected but absent from the publication (e.g. `TR_PUBLIC_PROCUREMENT_BAN`, `NOT_PUBLISHED`). */
  uncoveredSources: Array<{ datasetCode: string; displayName: string; reason: string }>;
}

export interface SanctionScreenAdverseMediaRequest {
  entityName?: string;
  entityType?: string;
  tckn?: string;
  vkn?: string;
  countryCode?: string;
  limit?: number;
  onlyActive?: boolean;
  customerReference?: string;
  productChannel?: string;
}

export interface SanctionBehavioralAlertRequest {
  subjectReference?: string;
  customerReference?: string;
  productChannel?: string;
  velocityScore?: number;
  unusualPattern?: boolean;
  countryRiskLevel?: string;
  metadataJson?: string;
}

export interface SanctionRegisterMonitoringRequest {
  externalCustomerId: string;
  subjectType?: SanctionSubjectTypeValue;
  /** Sent as `profileJson`. */
  profile?: Record<string, unknown>;
  profileJson?: string;
  frequency?: string;
  riskDomainScope?: SanctionRiskDomainValue[];
}

export interface SanctionPageFilters {
  limit?: number;
  /** Opaque; pass `nextCursor` back verbatim. */
  cursor?: string;
}

export interface SanctionPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Only when the gateway counted (`includeTotal: true`, deny list). */
  totalCount: number | null;
  raw: JsonObject;
}

export interface SanctionScreeningHistoryItem {
  runId: string;
  screeningType: string;
  subject: string;
  status: string;
  decision: string;
  hits: number;
  duration: string;
  createdAt: string;
  source: string;
  summary: string;
  tags: string[];
  timeline: string[];
  requestPayloadJson: string;
  resultJson: string;
}

/**
 * Sanctions screening — `client.sanction`. Calls carry the access token of your
 * API key; the key needs `SANCTION_SERVICE` and `sanction:view_results`. A
 * screening that cannot run throws (503 `ServiceUnavailableError`).
 */
export class SanctionClient {
  constructor(api: ApiClient);
  screenName(request: SanctionScreenNameRequest): Promise<SanctionScreenNameResult>;
  screenWallet(request: SanctionScreenWalletRequest): Promise<SanctionScreenWalletResult>;
  screenAccount(request: SanctionScreenAccountRequest): Promise<SanctionScreenAccountResult>;
  screenTransaction(request: SanctionScreenTransactionRequest): Promise<SanctionScreenTransactionResult>;
  screenPublicProcurementBan(request: SanctionScreenProcurementBanRequest): Promise<SanctionScreenProcurementBanResult>;
  screenAdverseMedia(request: SanctionScreenAdverseMediaRequest): Promise<JsonObject>;
  evaluateBehavioralAlert(request: SanctionBehavioralAlertRequest): Promise<JsonObject>;
  listScreeningHistory(filters?: SanctionPageFilters): Promise<SanctionPage<SanctionScreeningHistoryItem>>;
  iterateScreeningHistory(filters?: SanctionPageFilters): AsyncGenerator<SanctionScreeningHistoryItem, void, void>;
  registerMonitoring(request: SanctionRegisterMonitoringRequest): Promise<{ monitoredEntityId: string }>;
  listMonitoringAlerts(filters?: SanctionPageFilters & { status?: string; includeTotal?: boolean }): Promise<SanctionPage<JsonObject>>;
  iterateMonitoringAlerts(filters?: SanctionPageFilters & { status?: string }): AsyncGenerator<JsonObject, void, void>;
  listMonitoredEntities(filters?: SanctionPageFilters & { activeOnly?: boolean; includeTotal?: boolean }): Promise<SanctionPage<JsonObject>>;
  iterateMonitoredEntities(filters?: SanctionPageFilters & { activeOnly?: boolean }): AsyncGenerator<JsonObject, void, void>;
  listMonitoringMatches(filters?: SanctionPageFilters & { status?: string }): Promise<SanctionPage<JsonObject>>;
  iterateMonitoringMatches(filters?: SanctionPageFilters & { status?: string }): AsyncGenerator<JsonObject, void, void>;
  getDatasetFreshness(): Promise<{ manifest: unknown }>;
  searchEntities(filters: { q: string; limit?: number }): Promise<{ items: JsonObject[] } & JsonObject>;
  getEntityProfile(entityId: string, options?: { screeningRequestId?: string }): Promise<JsonObject>;
  getEntityGraph(entityId: string, options?: { depth?: number }): Promise<{ nodes: JsonObject[]; edges: JsonObject[] } & JsonObject>;
  getIndirectExposure(entityId: string, options?: { maxDepth?: number; entityIds?: string[] | string }): Promise<JsonObject>;
  getOwnershipAggregation(entityId: string, options?: { depth?: number; entityIds?: string[] | string }): Promise<{ paths: JsonObject[] } & JsonObject>;
  listBlacklistEntries(filters?: SanctionPageFilters): Promise<SanctionPage<JsonObject>>;
  iterateBlacklistEntries(filters?: SanctionPageFilters): AsyncGenerator<JsonObject, void, void>;
}

// ─────────────────────────────── Insurance ───────────────────────────────

export const InsurancePremiumCollectedBy: { readonly MERCHANT: 'MERCHANT'; readonly PROVIDER: 'PROVIDER' };
export type InsurancePremiumCollectedByValue = (typeof InsurancePremiumCollectedBy)[keyof typeof InsurancePremiumCollectedBy];

export const InsuranceQuoteStatus: {
  readonly REQUESTED: 'REQUESTED';
  readonly QUOTED: 'QUOTED';
  readonly EXPIRED: 'EXPIRED';
  readonly REJECTED: 'REJECTED';
  readonly ERROR: 'ERROR';
};
export type InsuranceQuoteStatusValue = (typeof InsuranceQuoteStatus)[keyof typeof InsuranceQuoteStatus];

/** Overall order status, derived from the four axes on every read (not stored). */
export const InsuranceOrderStatus: {
  readonly CREATED: 'CREATED';
  readonly PROCESSING: 'PROCESSING';
  readonly ACTION_REQUIRED: 'ACTION_REQUIRED';
  readonly PARTIALLY_ACTIVE: 'PARTIALLY_ACTIVE';
  readonly ACTIVE: 'ACTIVE';
  readonly FAILED: 'FAILED';
  readonly CANCELLED: 'CANCELLED';
  readonly REFUNDED: 'REFUNDED';
};
export type InsuranceOrderStatusValue = (typeof InsuranceOrderStatus)[keyof typeof InsuranceOrderStatus];

export const InsuranceCollectionStatus: {
  readonly NOT_STARTED: 'NOT_STARTED';
  readonly PENDING: 'PENDING';
  readonly ACTION_REQUIRED: 'ACTION_REQUIRED';
  readonly COLLECTED: 'COLLECTED';
  readonly FAILED: 'FAILED';
  readonly UNKNOWN: 'UNKNOWN';
};
export type InsuranceCollectionStatusValue = (typeof InsuranceCollectionStatus)[keyof typeof InsuranceCollectionStatus];

export const InsurancePolicyStatus: {
  readonly NOT_REQUESTED: 'NOT_REQUESTED';
  readonly PENDING: 'PENDING';
  readonly PARTIALLY_ISSUED: 'PARTIALLY_ISSUED';
  readonly ISSUED: 'ISSUED';
  readonly FAILED_RETRYABLE: 'FAILED_RETRYABLE';
  readonly FAILED_FINAL: 'FAILED_FINAL';
  readonly UNKNOWN: 'UNKNOWN';
  readonly CANCEL_PENDING: 'CANCEL_PENDING';
  readonly CANCELLED: 'CANCELLED';
};
export type InsurancePolicyStatusValue = (typeof InsurancePolicyStatus)[keyof typeof InsurancePolicyStatus];

export const InsuranceRefundStatus: {
  readonly NONE: 'NONE';
  readonly REQUIRED: 'REQUIRED';
  readonly PENDING: 'PENDING';
  readonly REFUNDED: 'REFUNDED';
  readonly FAILED: 'FAILED';
};
export type InsuranceRefundStatusValue = (typeof InsuranceRefundStatus)[keyof typeof InsuranceRefundStatus];

export const InsuranceDocumentStatus: {
  readonly NOT_AVAILABLE: 'NOT_AVAILABLE';
  readonly PENDING: 'PENDING';
  readonly AVAILABLE: 'AVAILABLE';
  readonly FAILED: 'FAILED';
};
export type InsuranceDocumentStatusValue = (typeof InsuranceDocumentStatus)[keyof typeof InsuranceDocumentStatus];

export const InsurancePaymentMode: {
  readonly LUNIXI_PAYMENT: 'LUNIXI_PAYMENT';
  readonly EXTERNAL_PAYMENT: 'EXTERNAL_PAYMENT';
  readonly NO_PAYMENT: 'NO_PAYMENT';
};
export type InsurancePaymentModeValue = (typeof InsurancePaymentMode)[keyof typeof InsurancePaymentMode];

export const InsuranceOrderSurface: {
  readonly MERCHANT_API: 'MERCHANT_API';
  readonly CHECKOUT_FORM: 'CHECKOUT_FORM';
  readonly PANEL: 'PANEL';
};
export type InsuranceOrderSurfaceValue = (typeof InsuranceOrderSurface)[keyof typeof InsuranceOrderSurface];

/** DISTRICT, DEVICE_MODEL, VEHICLE_MODEL, BANK_BRANCH and PET_BREED need `parentCode`; COUNTRY, CITY and BANK take none. */
export const InsuranceReferenceKind: {
  readonly COUNTRY: 'COUNTRY';
  readonly CITY: 'CITY';
  readonly DISTRICT: 'DISTRICT';
  readonly DEVICE_BRAND: 'DEVICE_BRAND';
  readonly DEVICE_MODEL: 'DEVICE_MODEL';
  readonly VEHICLE_BRAND: 'VEHICLE_BRAND';
  readonly VEHICLE_MODEL: 'VEHICLE_MODEL';
  readonly VEHICLE_TYPE: 'VEHICLE_TYPE';
  readonly PRODUCT_CATEGORY: 'PRODUCT_CATEGORY';
  readonly VEHICLE_USAGE: 'VEHICLE_USAGE';
  readonly LIABILITY_LIMIT: 'LIABILITY_LIMIT';
  readonly OCCUPATION: 'OCCUPATION';
  readonly PET_BREED: 'PET_BREED';
  readonly DWELLING_TYPE: 'DWELLING_TYPE';
  readonly DWELLING_FLOOR: 'DWELLING_FLOOR';
  readonly BANK: 'BANK';
  readonly BANK_BRANCH: 'BANK_BRANCH';
  readonly FINANCE_INSTITUTION: 'FINANCE_INSTITUTION';
  readonly MEDICAL_PROCEDURE_COVER: 'MEDICAL_PROCEDURE_COVER';
};
export type InsuranceReferenceKindValue = (typeof InsuranceReferenceKind)[keyof typeof InsuranceReferenceKind];

/**
 * Status of a lead: what Lunixi knows about sending it to the provider.
 * `UNKNOWN` is final (the lead is not sent again); `FAILED` carries `errorCode`.
 */
export const InsuranceLeadStatus: {
  readonly PENDING: 'PENDING';
  readonly SUBMITTED: 'SUBMITTED';
  readonly UNKNOWN: 'UNKNOWN';
  readonly FAILED: 'FAILED';
};
export type InsuranceLeadStatusValue = (typeof InsuranceLeadStatus)[keyof typeof InsuranceLeadStatus];

/** Insurance webhook event types deliverable to a merchant endpoint. */
export const InsuranceEvents: {
  readonly POLICY_ISSUED: 'insurance.policy.issued';
  readonly POLICY_FAILED: 'insurance.policy.failed';
  readonly REFUND_REQUIRED: 'insurance.refund.required';
  readonly POLICY_DOCUMENT_READY: 'insurance.policy.document_ready';
  readonly POLICY_CANCELLED: 'insurance.policy.cancelled';
  readonly REFUND_COMPLETED: 'insurance.refund.completed';
  /** A lead was received by the provider; `data` is `InsuranceLeadWebhookData`. */
  readonly LEAD_SUBMITTED: 'insurance.lead.submitted';
};
export type InsuranceEventType = (typeof InsuranceEvents)[keyof typeof InsuranceEvents];
/** The events about an order; their `data` is `InsuranceWebhookData`. */
export type InsuranceOrderEventType = Exclude<InsuranceEventType, 'insurance.lead.submitted'>;
/** The events about a lead; their `data` is `InsuranceLeadWebhookData`. */
export type InsuranceLeadEventType = Extract<InsuranceEventType, 'insurance.lead.submitted'>;
export const INSURANCE_EVENT_TYPES: readonly InsuranceEventType[];
/** Subscription pattern covering every insurance event. */
export const INSURANCE_EVENT_PATTERN: 'insurance.*';

/** Top-level fields `createQuote()` accepts; any other is refused before sending. */
export const INSURANCE_QUOTE_FIELDS: readonly string[];
/** Top-level fields `createLead()` accepts; any other is refused before sending. */
export const INSURANCE_LEAD_FIELDS: readonly string[];

/** Query filters each read accepts; any other is refused before sending. */
export const INSURANCE_FILTERS: {
  readonly listProducts: readonly string[];
  readonly listReferenceValues: readonly string[];
  readonly listOrders: readonly string[];
  readonly getReconciliationSummary: readonly string[];
  readonly listReconciliationOrders: readonly string[];
  readonly exportReconciliation: readonly string[];
  readonly listLeads: readonly string[];
};

/** Text per language code, e.g. `{ tr: '…', en: '…' }`. */
export type InsuranceLocalizedText = Record<string, string>;

/** The provider connection behind a quote, an order or a policy. Informational; `code` is Lunixi's catalogue code. */
export interface InsuranceProvider {
  code: string;
  name: string;
  logoUrl: string | null;
  connectionId: string;
}

/** The insurance company behind a quote option, apart from the provider that brokers it (`provider`). */
export interface InsuranceUnderwriter {
  /** Lunixi code of the company; the same company from two providers has the same code. */
  code: string;
  name: string;
  logoUrl: string | null;
  /** The company's own information text to show the buyer, if any. */
  disclosureText: string | null;
}

/** Stage at which a field becomes required. */
export type InsuranceFieldStage = 'QUOTE' | 'POLICY';

/** A field required by only some insurance companies, or earlier than the type itself requires it. */
export interface InsuranceFieldRequirement {
  /** `null` when the requirement has no company code. */
  underwriterCode: string | null;
  stage: InsuranceFieldStage;
}

/** An insurance type offered for basket items, or sold without one (`basketItemIds` empty). */
export interface InsuranceProduct {
  /** Lunixi insurance type code, e.g. `TICKET_CANCELLATION`. */
  insuranceType: string;
  /** Name of the type's object in the quote body, e.g. `tickets`. */
  typeObject: string;
  schemaVersion: number;
  /** Basket item ids the type covers. */
  basketItemIds: string[];
  title: InsuranceLocalizedText;
  description: InsuranceLocalizedText;
  /**
   * Field definitions of the type: the live list of what the quote request
   * needs, for every insurance company open to you. A definition may carry
   * `requiredAt` (`InsuranceFieldStage`, required by all of them) and
   * `requiredBy` (`InsuranceFieldRequirement[]`, required only by some or
   * earlier); a company whose required field is missing is left out of the
   * quote (`InsuranceQuoteSet.excludedOptions`).
   */
  fields: JsonObject[];
  /**
   * Values taken from the items' `insuranceContext`, in the shape of the quote
   * body (e.g. `{ tickets: [{ basketItemId, transportMode, departureAt }] }`);
   * no personal data. A field also sent in `insuranceData` is in
   * `providedFields` instead. `{}` when there is nothing to prefill.
   */
  prefill: JsonObject;
  /**
   * The fields sent in the items' `insuranceData`, by path in the quote body
   * (e.g. `insured[0].identityNumber`, `tickets[0].pnr`), each with its value
   * masked; a personal value is never returned in clear. `[]` when none.
   */
  providedFields: InsuranceProvidedField[];
  /**
   * `true` when the prefilled and provided fields together meet what the quote
   * needs, for at least one insurance company open to you: a quote with
   * `paymentIntentId` and no type fields can be priced. The Checkout Form then
   * prices the insurance on its own when it opens.
   */
  quoteReady: boolean;
  /** `insuranceData` that could not be used (not stored, the buyer is asked for it). `[]` when none. */
  insuranceDataIssues: InsuranceDataIssue[];
}

/** A field sent in a basket item's `insuranceData` (`InsuranceProduct.providedFields`). */
export interface InsuranceProvidedField {
  /** Path in the quote body, e.g. `insured[0].birthDate`. */
  path: string;
  /** The value, masked (a personal value is never in clear). */
  masked: unknown;
}

/** Why a basket item's `insuranceData` could not be used (`InsuranceProduct.insuranceDataIssues`); no value. */
export interface InsuranceDataIssue {
  basketItemId: string;
  /** Field path, e.g. `device.imei`; `insuranceData` when the whole object is refused. */
  field: string;
  /** Reason code, e.g. `unknown_field`, `not_applicable`, `no_matching_schema`. */
  reason: string;
}

export interface InsuranceProductList {
  /** Empty when insurance is not offered; not an error. */
  products: InsuranceProduct[];
}

export interface InsuranceReferenceValue {
  code: string;
  label: InsuranceLocalizedText;
  parentCode: string | null;
}

/** `context` of `searchProducts()` and `createQuote()`: the basket items the payment will carry (1–100). */
export interface InsuranceItemsContext {
  items: Array<BasketItem | BasketItemFields>;
}

export interface InsuranceProductSearchRequest {
  currency: string;
  insuranceType?: string;
  context: InsuranceItemsContext;
}

export interface InsuranceProductFilters {
  /** ISO 4217, required. */
  currency: string;
  /** The payment whose recorded basket is read; left out, the types sold without a basket item are listed. */
  paymentIntentId?: string;
  insuranceType?: string;
}

/**
 * Body of `createQuote()`: `paymentIntentId` or `context`, not both; neither
 * for an insurance type sold without a basket item. `policyholder`, `insured`
 * and the type object (`InsuranceProduct.typeObject`, e.g. `tickets` for
 * `TICKET_CANCELLATION`) follow the type's schema; the list of fields is
 * `InsuranceProduct.fields`. Policy-stage fields (e.g. `pnr`, `ticketNumber`,
 * the insured's `email` and `phone`) must be sent here too: there is no later
 * call to add them.
 *
 * The quote starts from the items' `insuranceContext` and `insuranceData`: the
 * data recorded with the payment (`paymentIntentId`) or the `insuranceData` of
 * `context.items` (used for this call only, not stored). Send only what is
 * missing or what you want to change; a field you send wins over the item's.
 * When the products answer says `quoteReady`, `insuranceType`, `currency` and
 * `paymentIntentId` are enough.
 */
export interface InsuranceQuoteRequest {
  insuranceType: string;
  /** 1–1000; the type's current schema when left out. */
  schemaVersion?: number;
  currency: string;
  paymentIntentId?: string;
  context?: InsuranceItemsContext;
  /** At most 128 characters. */
  merchantOrderId?: string;
  policyholder?: JsonObject;
  /** At most 10. */
  insured?: JsonObject[];
  /** `TICKET_CANCELLATION`: at most 10, one per basket item (`basketItemId`). */
  tickets?: JsonObject[];
  /** `HOTEL_CANCELLATION` */
  stay?: JsonObject;
  /** `DEVICE_INSURANCE`, `DEVICE_PROTECTION` */
  device?: JsonObject;
  /** `EXTENDED_WARRANTY` */
  product?: JsonObject;
  /** `ROADSIDE_ASSISTANCE`, `VEHICLE_TAG_PROTECTION`, `MOTOR_GREEN_CARD` */
  vehicle?: JsonObject;
  /** `TRAVEL_HEALTH`, `INBOUND_TRAVEL_HEALTH` */
  trip?: JsonObject;
  /** `MICROMOBILITY_ACCIDENT` */
  rental?: JsonObject;
  /** `MUSICAL_INSTRUMENT_PROTECTION` */
  instrument?: JsonObject;
  /** `EVENT_ACCIDENT` */
  event?: JsonObject;
  /** `PERSONAL_ACCIDENT` (sold without a basket item) */
  accident?: JsonObject;
  /** `MEDICAL_COMPLICATION` */
  procedure?: JsonObject;
  /** `PET_HEALTH` */
  pet?: JsonObject;
  /** `FOREIGN_RESIDENT_HEALTH` (sold without a basket item) */
  residence?: JsonObject;
  /** `ABROAD_STAY_HEALTH` */
  abroadStay?: JsonObject;
}

/**
 * Body of `createLead()`, for an insurance type sold by request only. The
 * fields follow the type's lead schema: `policyholder`, the type object and
 * an optional `note`. There is no amount, currency, basket item or payment.
 */
export interface InsuranceLeadRequest {
  insuranceType: string;
  /** 1–1000; the type's current lead schema when left out. */
  schemaVersion?: number;
  policyholder?: JsonObject;
  /** At most 10. */
  insured?: JsonObject[];
  tickets?: JsonObject[];
  stay?: JsonObject;
  device?: JsonObject;
  product?: JsonObject;
  /** `MOTOR_THIRD_PARTY_LIABILITY`, `MOTOR_COMPREHENSIVE`; the carrying vehicle in `CARGO_TRANSIT` */
  vehicle?: JsonObject;
  trip?: JsonObject;
  rental?: JsonObject;
  instrument?: JsonObject;
  event?: JsonObject;
  accident?: JsonObject;
  procedure?: JsonObject;
  pet?: JsonObject;
  residence?: JsonObject;
  abroadStay?: JsonObject;
  /** `CARGO_TRANSIT` */
  shipment?: JsonObject;
  /** `CARGO_TRANSIT`, optional: the company's tax identity. */
  company?: JsonObject;
  /** Free text, at most 1000 characters. Masked in every answer. */
  note?: string;
}

/** A lead. The provider's name, code and reference are not part of it. */
export interface InsuranceLead {
  /** `insl_…`. */
  leadId: string;
  insuranceType: string;
  schemaVersion: number;
  status: InsuranceLeadStatusValue;
  /** Lunixi error code (`insurance.<area>.<reason>`) of a `FAILED` lead. */
  errorCode: string | null;
  /** The lead as sent, with the personal fields and the note masked (`***`). */
  requestMasked: JsonObject;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceTerms {
  version: string;
  sha256: string;
}

export interface InsuranceQuoteOption {
  quoteId: string;
  insuranceType: string;
  schemaVersion: number;
  title: string | null;
  /** Minor units. */
  premiumAmount: number;
  currency: string;
  premiumCollectedBy: InsurancePremiumCollectedByValue;
  provider: InsuranceProvider;
  /** Basket item ids the option covers. */
  basketItemIds: string[];
  coverageSummary: string[];
  terms: InsuranceTerms;
  underwriterName: string | null;
  /** The insurance company; `null` when none is reported. */
  underwriter: InsuranceUnderwriter | null;
  expiresAt: string;
  status: InsuranceQuoteStatusValue;
  paymentIntentId: string | null;
  createdAt: string;
}

/**
 * An insurance company the request could not be priced with. Only this option
 * is left out; complete the fields and quote again. No value and no provider
 * code is returned, only field paths.
 */
export interface InsuranceExcludedQuoteOption {
  underwriter: InsuranceUnderwriter | null;
  provider: InsuranceProvider;
  /** Lunixi error code, `insurance.validation.invalid` for missing fields. */
  errorCode: string;
  /** Field paths and reasons, e.g. `{ field: 'insured[0].birthDate', reason: 'required' }`. */
  errors: Array<{ field: string; reason: string }>;
}

export interface InsuranceQuoteSet {
  insuranceType: string;
  schemaVersion: number;
  /** One or more options, each with its own `quoteId` and expiry. */
  options: InsuranceQuoteOption[];
  /** Insurance companies left out of this quote; empty when every one was priced. */
  excludedOptions: InsuranceExcludedQuoteOption[];
}

export interface InsuranceConsent {
  /** The option's `terms.version`, unchanged. */
  termsVersion: string;
  /** The option's `terms.sha256`, unchanged. */
  termsSha256: string;
  /** When the buyer accepted; ISO 8601 with a time zone, not in the future. */
  acceptedAt: string | Date;
}

export interface InsuranceOrderRequest {
  quoteId: string;
  /** Defaults to the quote's; must match it when both are set. */
  merchantOrderId?: string;
  consent: InsuranceConsent;
}

export interface InsuranceOrderPolicy {
  policyId: string;
  basketItemId: string;
  policyNumber: string | null;
  policyStatus: InsurancePolicyStatusValue;
  documentStatus: InsuranceDocumentStatusValue;
}

export interface InsuranceOrder {
  orderId: string;
  quoteId: string;
  insuranceType: string;
  surface: InsuranceOrderSurfaceValue;
  status: InsuranceOrderStatusValue;
  collectionStatus: InsuranceCollectionStatusValue;
  policyStatus: InsurancePolicyStatusValue;
  refundStatus: InsuranceRefundStatusValue;
  documentStatus: InsuranceDocumentStatusValue;
  paymentMode: InsurancePaymentModeValue;
  premiumCollectedBy: InsurancePremiumCollectedByValue;
  /** Minor units. */
  premiumAmount: number;
  currency: string;
  paymentIntentId: string | null;
  merchantOrderId: string | null;
  provider: InsuranceProvider;
  basketItemIds: string[];
  policies: InsuranceOrderPolicy[];
  /** Lunixi error code (`insurance.<area>.<reason>`). */
  errorCode: string | null;
  refundErrorCode: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsurancePage<T> {
  items: T[];
  hasMore: boolean;
  /** Opaque — pass back verbatim as `cursor`. */
  nextCursor: string | null;
}

export interface InsurancePageFilters {
  /** 1–100. */
  limit?: number;
  cursor?: string;
}

export interface InsuranceReferenceFilters extends InsurancePageFilters {
  /** Province for DISTRICT, brand for DEVICE_MODEL and VEHICLE_MODEL. */
  parentCode?: string;
}

export interface InsuranceOrderFilters extends InsurancePageFilters {
  paymentIntentId?: string;
  merchantOrderId?: string;
}

export interface InsuranceLeadFilters extends InsurancePageFilters {
  insuranceType?: string;
  status?: InsuranceLeadStatusValue;
}

/** A premium you collected outside Lunixi (`confirmPayment()`). */
export interface InsuranceExternalPayment {
  /** 1–128 printable ASCII characters. */
  externalPaymentId: string;
  /** Minor units; must equal the order's premium. */
  paidAmount: number;
  /** Must equal the order's currency. */
  paidCurrency: string;
  /** ISO 8601 with a time zone, not in the future. */
  paidAt: string | Date;
  /** Who took the payment (informational), at most 64 characters. */
  paymentProvider?: string;
}

/** A refund you made outside Lunixi (`refundPremium()`). */
export interface InsuranceExternalRefund {
  externalRefundId: string;
  /** ISO 8601 with a time zone; not in the future, not before the payment. */
  refundedAt: string | Date;
}

export interface InsuranceRefundOptions {
  /** Only for a premium collected outside Lunixi; leave out for a Lunixi payment. */
  externalRefund?: InsuranceExternalRefund;
}

export interface InsuranceReconciliationFilters {
  /** Inclusive, on the order creation time. ISO 8601 with a time zone. */
  from: string | Date;
  /** Exclusive; at most 366 days after `from`. */
  to: string | Date;
  connectionId?: string;
  insuranceType?: string;
  currency?: string;
}

export interface InsuranceReconciliationOrderFilters extends InsuranceReconciliationFilters, InsurancePageFilters {}

export interface InsuranceReconciliationExportFilters extends InsuranceReconciliationFilters {
  /** `nextCursor` of a truncated export. */
  cursor?: string;
}

/** Minor-unit totals of one reconciliation group. In force = ISSUED or CANCEL_PENDING; open refund = REQUIRED, PENDING or FAILED. */
export interface InsuranceReconciliationTotals {
  orderCount: number;
  premiumAmount: number;
  collectedOrderCount: number;
  collectedPremiumAmount: number;
  policyCount: number;
  inForcePolicyCount: number;
  inForcePremiumAmount: number;
  cancelledPolicyCount: number;
  cancelledPremiumAmount: number;
  refundedOrderCount: number;
  refundedPremiumAmount: number;
  refundOpenOrderCount: number;
  refundOpenPremiumAmount: number;
}

export interface InsuranceReconciliationSummary {
  period: { from: string; to: string };
  filters: { connectionId: string | null; insuranceType: string | null; currency: string | null };
  groups: Array<{
    provider: InsuranceProvider;
    currency: string;
    premiumCollectedBy: InsurancePremiumCollectedByValue;
    totals: InsuranceReconciliationTotals;
  }>;
  generatedAt: string;
}

export interface InsuranceReconciliationOrder {
  orderId: string;
  merchantOrderId: string | null;
  paymentIntentId: string | null;
  externalPaymentId: string | null;
  insuranceType: string;
  connectionId: string;
  providerCode: string;
  premiumCollectedBy: InsurancePremiumCollectedByValue;
  paymentMode: InsurancePaymentModeValue;
  premiumAmount: number;
  currency: string;
  collectionStatus: InsuranceCollectionStatusValue;
  policyStatus: InsurancePolicyStatusValue;
  refundStatus: InsuranceRefundStatusValue;
  createdAt: string;
  collectedAt: string | null;
  refundedAt: string | null;
  policies: Array<{
    policyId: string;
    basketItemId: string;
    policyNumber: string | null;
    policyStatus: InsurancePolicyStatusValue;
    premiumAmount: number;
    cancelledAt: string | null;
  }>;
}

/** `exportReconciliation()`: the CSV file and how it ended. */
export interface InsuranceReconciliationExport extends BinaryResponse {
  /** The file was cut at 20000 orders; continue with `nextCursor`. */
  truncated: boolean;
  nextCursor: string | null;
  /** The file ends with the abort line: it is incomplete, request it again. */
  aborted: boolean;
}

/** A policy in an insurance webhook's `data`. */
export interface InsuranceWebhookPolicy {
  policyId: string;
  basketItemId: string;
  policyNumber: string | null;
  policyStatus: InsurancePolicyStatusValue;
  documentStatus: InsuranceDocumentStatusValue;
  /** `getPolicyDocument()` address while the policy is in force, otherwise an empty string. Downloading it is a signed API call. */
  documentUrl: string;
}

/** The `data` of every order `insurance.*` webhook. No other key is delivered; no personal data. */
export interface InsuranceWebhookData {
  /** Same as the envelope's id; dedupe on it. */
  eventId: string;
  eventType: InsuranceOrderEventType;
  merchantId: string;
  insuranceOrderId: string;
  paymentIntentId: string | null;
  merchantOrderId: string | null;
  insuranceType: string;
  premiumCollectedBy: InsurancePremiumCollectedByValue;
  provider: InsuranceProvider;
  status: InsuranceOrderStatusValue;
  collectionStatus: InsuranceCollectionStatusValue;
  policyStatus: InsurancePolicyStatusValue;
  refundStatus: InsuranceRefundStatusValue;
  documentStatus: InsuranceDocumentStatusValue;
  /** Minor units. */
  premiumAmount: number;
  currency: string;
  policies: InsuranceWebhookPolicy[];
  /** Only on `insurance.policy.failed` and `insurance.refund.required`. */
  errorCode?: string | null;
  createdAt: string;
}

/** The lead in an `insurance.lead.*` webhook. No personal data, no note, no provider reference. */
export interface InsuranceWebhookLead {
  leadId: string;
  insuranceType: string;
  schemaVersion: number;
  status: InsuranceLeadStatusValue;
  submittedAt: string | null;
  createdAt: string;
}

/** The `data` of an `insurance.lead.*` webhook. No other key is delivered. */
export interface InsuranceLeadWebhookData {
  /** Same as the envelope's id; dedupe on it. */
  eventId: string;
  eventType: InsuranceLeadEventType;
  merchantId: string;
  lead: InsuranceWebhookLead;
  createdAt: string;
}

/**
 * Insurance — `client.insurance`. Every call is signed; the key needs the
 * INSURANCE_SERVICE product. `createOrder`, `confirmPayment`, `issuePolicy`,
 * `cancelOrder`, `refundPremium` and `createLead` require an `Idempotency-Key` (8–200
 * printable ASCII characters); `createQuote` and `bindPayment` take one
 * optionally.
 */
export class InsuranceClient {
  constructor(api: ApiClient);
  listProducts(filters: InsuranceProductFilters): Promise<InsuranceProductList>;
  searchProducts(request: InsuranceProductSearchRequest): Promise<InsuranceProductList>;
  listReferenceValues(kind: InsuranceReferenceKindValue, filters?: InsuranceReferenceFilters): Promise<InsurancePage<InsuranceReferenceValue>>;
  iterateReferenceValues(kind: InsuranceReferenceKindValue, filters?: InsuranceReferenceFilters): AsyncGenerator<InsuranceReferenceValue, void, void>;
  /** HTTP 201. */
  createQuote(request: InsuranceQuoteRequest, idempotencyKey?: string | null): Promise<InsuranceQuoteSet>;
  getQuote(quoteId: string): Promise<InsuranceQuoteOption>;
  /** HTTP 201. */
  createOrder(request: InsuranceOrderRequest, idempotencyKey: string): Promise<InsuranceOrder>;
  listOrders(filters?: InsuranceOrderFilters): Promise<InsurancePage<InsuranceOrder>>;
  iterateOrders(filters?: InsuranceOrderFilters): AsyncGenerator<InsuranceOrder, void, void>;
  getOrder(orderId: string): Promise<InsuranceOrder>;
  bindPayment(orderId: string, paymentIntentId: string, idempotencyKey?: string | null): Promise<InsuranceOrder>;
  confirmPayment(orderId: string, payment: InsuranceExternalPayment, idempotencyKey: string): Promise<InsuranceOrder>;
  issuePolicy(orderId: string, idempotencyKey: string): Promise<InsuranceOrder>;
  cancelOrder(orderId: string, idempotencyKey: string): Promise<InsuranceOrder>;
  refundPremium(orderId: string, options: InsuranceRefundOptions | undefined, idempotencyKey: string): Promise<InsuranceOrder>;
  /** HTTP 201. */
  createLead(request: InsuranceLeadRequest, idempotencyKey: string): Promise<InsuranceLead>;
  listLeads(filters?: InsuranceLeadFilters): Promise<InsurancePage<InsuranceLead>>;
  iterateLeads(filters?: InsuranceLeadFilters): AsyncGenerator<InsuranceLead, void, void>;
  getLead(leadId: string): Promise<InsuranceLead>;
  /** `application/pdf`. */
  getPolicyDocument(policyId: string): Promise<BinaryResponse>;
  /** `application/pdf`; 412 `insurance.document.not_supported` for a product without a receipt. */
  getPolicyReceipt(policyId: string): Promise<BinaryResponse>;
  /** `application/pdf`; 412 `insurance.document.not_supported` for a product without a certificate. */
  getPolicyCertificate(policyId: string): Promise<BinaryResponse>;
  getReconciliationSummary(filters: InsuranceReconciliationFilters): Promise<InsuranceReconciliationSummary>;
  listReconciliationOrders(filters: InsuranceReconciliationOrderFilters): Promise<InsurancePage<InsuranceReconciliationOrder>>;
  iterateReconciliationOrders(filters: InsuranceReconciliationOrderFilters): AsyncGenerator<InsuranceReconciliationOrder, void, void>;
  /** `text/csv; charset=utf-8`. */
  exportReconciliation(filters: InsuranceReconciliationExportFilters): Promise<InsuranceReconciliationExport>;
  /** `consent` for `createOrder()` from a quote option's `terms`. */
  static consentFromQuote(option: Pick<InsuranceQuoteOption, 'terms'>, acceptedAt: string | Date): InsuranceConsent & { acceptedAt: string };
  /** The premium basket item (`id` = orderId, VIRTUAL, `price` = premium) of a MERCHANT-collected order. */
  static premiumBasketItem(
    order: Pick<InsuranceOrder, 'orderId' | 'premiumAmount' | 'premiumCollectedBy'>,
    fields: { name: string; category1: string; category2?: string },
  ): BasketItem;
}
