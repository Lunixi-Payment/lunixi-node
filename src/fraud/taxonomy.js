'use strict';

/**
 * Fraud request dictionaries.
 *
 * These mirror the gateway's closed dictionaries. A value outside them is
 * rejected with 400 — the gateway runs `forbidNonWhitelisted`, so an invented
 * value never reaches the engine.
 *
 * Source of truth: `libs/proto/src/fraud-taxonomy.ts` +
 * `apps/api-gateway/src/fraud/dtos/evaluate-fraud-decision.dto.ts`.
 */

/**
 * Channels an external caller may declare.
 *
 * `lunixi_checkout` and `wallet` are NOT declarable: they come only from
 * Lunixi's own services, and declaring one from outside would be a way to
 * trigger flows bound to a platform channel (→ 400).
 */
const CHANNELS = Object.freeze({
  MERCHANT_FORM: 'merchant_form',
  STANDALONE_API: 'standalone_api',
});

/** Decision surface inside a channel. */
const SURFACES = Object.freeze({
  FORM_GATE: 'form_gate',
  TRANSACTION: 'transaction',
  WITHDRAWAL_GATE: 'withdrawal_gate',
  SETTLEMENT: 'settlement',
});

/** Evaluation moment in the transaction lifecycle. */
const STAGES = Object.freeze({
  PRE_AUTHORIZATION: 'pre_authorization',
  POST_AUTHENTICATION: 'post_authentication',
  POST_HOC: 'post_hoc',
  ASYNC_EVENT: 'async_event',
  SCHEDULED: 'scheduled',
});

/** Business operation kind. */
const OPERATION_KINDS = Object.freeze({
  CARD_SALE: 'card_sale',
  CARD_PREAUTH: 'card_preauth',
  W2W_TRANSFER: 'w2w_transfer',
  W2IBAN_WITHDRAWAL: 'w2iban_withdrawal',
  BULK_PAYOUT: 'bulk_payout',
  AGENT_CASH_OUT: 'agent_cash_out',
  BILL_PAYMENT: 'bill_payment',
  MERCHANT_PAYMENT: 'merchant_payment',
  QR_PAYMENT: 'qr_payment',
  CARD_TOPUP: 'card_topup',
  AGENT_TOPUP: 'agent_topup',
  BANK_TRANSFER_TOPUP: 'bank_transfer_topup',
  OUTBOUND_TRANSFER: 'outbound_transfer',
  INBOUND_TRANSFER: 'inbound_transfer',
});

/** Authentication mode (requested and applied travel in separate fields). */
const AUTH_MODES = Object.freeze({
  TWO_D: '2d',
  THREE_D: '3d',
});

/**
 * Product contexts an external caller may declare. `simulation`,
 * `post_hoc_backfill` and `manual_review` belong to platform senders only
 * (unbilled lane) and are rejected from outside.
 */
const PRODUCT_CONTEXTS = Object.freeze({
  LIVE_SESSION: 'live_session',
  PAYMENT_FORM: 'payment_form',
  HOSTED_PAYMENT_FORM: 'hosted_payment_form',
  DIRECT_API: 'direct_api',
});

/**
 * The only integration mode an external caller may declare. Sending anything
 * else is a 400 — `gateway_integrated` belongs to Lunixi's internal senders.
 */
const INTEGRATION_MODE_STANDALONE = 'standalone';

/** Maximum length of `transactionRef` and `subjectId`. */
const TRANSACTION_REF_MAX_LENGTH = 180;
const SUBJECT_ID_MAX_LENGTH = 180;

/** `subMerchantRef` format: letters, digits and `. _ : @ -`, up to 180 chars. */
const SUB_MERCHANT_REF_PATTERN = /^[A-Za-z0-9._:@-]{1,180}$/;

const values = (frozen) => Object.freeze(Object.values(frozen));

module.exports = {
  CHANNELS,
  SURFACES,
  STAGES,
  OPERATION_KINDS,
  AUTH_MODES,
  PRODUCT_CONTEXTS,
  INTEGRATION_MODE_STANDALONE,
  TRANSACTION_REF_MAX_LENGTH,
  SUBJECT_ID_MAX_LENGTH,
  SUB_MERCHANT_REF_PATTERN,
  CHANNEL_VALUES: values(CHANNELS),
  SURFACE_VALUES: values(SURFACES),
  STAGE_VALUES: values(STAGES),
  OPERATION_KIND_VALUES: values(OPERATION_KINDS),
  AUTH_MODE_VALUES: values(AUTH_MODES),
  PRODUCT_CONTEXT_VALUES: values(PRODUCT_CONTEXTS),
};
