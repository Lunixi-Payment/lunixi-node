import type { CheckoutIntent, CheckoutIntentEnvelope, CheckoutPage, JsonObject, LunixiClient } from '../../src';
export interface NativeCheckoutAttempt {
  /** Immutable persisted request from the owned server order, not browser JSON. */
  request: JsonObject;
  key: string;
  createdAtSeconds: number;
  state: 'reserved' | 'pending';
  /** Preserve existing explicit choices; new reservations default to embedded. */
  mode?: 'embedded' | 'redirect';
  locale?: 'en' | 'tr';
  /** Decrypted only after native auth/CSRF/owner checks. Encrypt at rest. */
  response?: CheckoutIntent | CheckoutIntentEnvelope;
}
export interface NativeCheckoutAdapter {
  authenticate(request: unknown): Promise<unknown>;
  verifyCsrf(request: unknown, principal: unknown): Promise<boolean>;
  /** Atomic native reservation: owner/merchant/environment/totals + immutable request/key/settings. */
  reserveCheckout(principal: unknown, orderId: string): Promise<NativeCheckoutAttempt>;
  /** Atomic same-attempt/payment binding and encrypted capability persistence. */
  bindCheckoutResponse(attempt: NativeCheckoutAttempt, response: CheckoutIntent | CheckoutIntentEnvelope): Promise<void>;
  /** Preserve the original request/key and hold fulfillment until authenticated reconciliation. */
  markCheckoutUncertain(attempt: NativeCheckoutAttempt): Promise<void>;
}
export function createNativeCheckout(client: LunixiClient, native: NativeCheckoutAdapter, now?: () => number): (request: unknown, orderId: string) => Promise<CheckoutPage>;
