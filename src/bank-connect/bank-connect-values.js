'use strict';

/**
 * Bank accounts (`/api/v1/bank-connect`, product BANK_CONNECT) — value sets
 * and query filters.
 *
 * Source: nest-payment-gateway apps/api-gateway/src/bank-connect/
 * (bank-connect.constants.ts, dtos/bank-connect-api.dto.ts,
 * dtos/bank-connect-transfer.dto.ts, mappers/bank-connect-api.mapper.ts,
 * mappers/bank-connect-transfer.mapper.ts). The PHP SDK's `BankConnect\*`
 * constants carry the same sets.
 */

/**
 * Status of a bank connection. Data is read only while a connection is ACTIVE
 * or DEGRADED (DEGRADED: the last reads from the bank failed, so the data may
 * be older; see the account's `freshness`). `requestSync()` on any other
 * status is 409 `bank_connect.connection.not_active`.
 */
const BankConnectionStatus = Object.freeze({
  PENDING_DOCUMENTS: 'PENDING_DOCUMENTS',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PENDING_SETUP: 'PENDING_SETUP',
  ACTIVE: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  SUSPENDED: 'SUSPENDED',
  DISCONNECTED: 'DISCONNECTED',
});

const BankAccountStatus = Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' });

/** Money in (CREDIT) or out (DEBIT). `amountMinor` is always positive. */
const BankTransactionDirection = Object.freeze({ CREDIT: 'CREDIT', DEBIT: 'DEBIT' });

/** Lunixi's bank-independent transaction type (`canonicalType`). */
const BankTransactionType = Object.freeze({
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  INTERNAL_IN: 'INTERNAL_IN',
  INTERNAL_OUT: 'INTERNAL_OUT',
  POS_SETTLEMENT: 'POS_SETTLEMENT',
  POS_SETTLEMENT_REFUND: 'POS_SETTLEMENT_REFUND',
  FEE: 'FEE',
  TAX: 'TAX',
  CASH_IN: 'CASH_IN',
  CASH_OUT: 'CASH_OUT',
  CARD: 'CARD',
  LOAN: 'LOAN',
  FX: 'FX',
  INTEREST: 'INTEREST',
  OTHER: 'OTHER',
});

/** AVAILABLE: the bank can be connected (connections are started in the Lunixi dashboard). */
const BankAvailability = Object.freeze({ AVAILABLE: 'AVAILABLE', COMING_SOON: 'COMING_SOON' });

/**
 * What a bank or a connection offers (`capabilities`). OUTGOING_TRANSFER and
 * FX_EXCHANGE: the connection can send transfers (`bankConnect.transfers`) and
 * exchange currency (`bankConnect.fx`).
 */
const BankCapability = Object.freeze({
  ACCOUNT_LIST: 'ACCOUNT_LIST',
  BALANCE: 'BALANCE',
  TRANSACTIONS: 'TRANSACTIONS',
  OUTGOING_TRANSFER: 'OUTGOING_TRANSFER',
  FX_EXCHANGE: 'FX_EXCHANGE',
});

/** QUEUED: the read starts now or is already waiting. SCHEDULED: it runs at `scheduledAt`. */
const BankSyncStatus = Object.freeze({ QUEUED: 'QUEUED', SCHEDULED: 'SCHEDULED' });

/**
 * Bank-account webhook event types, delivered in the same signed envelope as
 * every Lunixi webhook and verified with `WebhookVerifier`.
 */
const BankConnectEvents = Object.freeze({
  /**
   * A new transaction (CREDIT or DEBIT) was read from one of your connected
   * accounts. Sent once per transaction, for transactions first seen by a
   * regular read after the connection became active; the history loaded when
   * an account is first connected does not send it. The event id is the same
   * on every redelivery: dedupe on it.
   */
  TRANSACTION_RECEIVED: 'bank_account.transaction.received',
});

/** Subscription pattern covering every bank-account event. */
const BANK_CONNECT_EVENT_PATTERN = 'bank_account.*';

const BANK_CONNECT_EVENT_TYPES = Object.freeze(Object.values(BankConnectEvents));

/**
 * Status of an outgoing transfer.
 *
 * PENDING_OTP: started in the dashboard, waiting for the user's e-mail code
 * (an API-key transfer never has it). SUBMITTED: approved and queued or sent
 * to the bank, waiting for its answer. PROCESSING: the bank is processing it.
 * COMPLETED: the bank completed it; it can still become RETURNED if the
 * receiving bank sends it back. FAILED, RETURNED, CANCELED are final.
 */
const BankTransferStatus = Object.freeze({
  PENDING_OTP: 'PENDING_OTP',
  SUBMITTED: 'SUBMITTED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
  CANCELED: 'CANCELED',
});

/** The rail the bank chose: own accounts, same bank, FAST, EFT; UNKNOWN until it says. */
const BankTransferRail = Object.freeze({
  INTERNAL: 'INTERNAL',
  INTRABANK: 'INTRABANK',
  FAST: 'FAST',
  EFT: 'EFT',
  UNKNOWN: 'UNKNOWN',
});

/** Where the transfer or exchange order was started. */
const BankTransferInitiatedVia = Object.freeze({ PANEL: 'PANEL', API: 'API' });

/** Status of a currency exchange order. An order is created SUBMITTED. */
const BankFxOrderStatus = Object.freeze({ SUBMITTED: 'SUBMITTED', COMPLETED: 'COMPLETED', FAILED: 'FAILED' });

/** Which amount of a quote you fixed: SOURCE (sell amount) or TARGET (buy amount). */
const BankFxRequestedSide = Object.freeze({ SOURCE: 'SOURCE', TARGET: 'TARGET' });

/**
 * Transfer webhook event types (product BANK_CONNECT), delivered in the same
 * signed envelope as every Lunixi webhook. One event per transfer and type;
 * the event id is the same on every redelivery.
 */
const BankTransferEvents = Object.freeze({
  /** A transfer was created (API: SUBMITTED; dashboard: PENDING_OTP). */
  CREATED: 'bank_transfer.created',
  /** The bank completed the transfer. */
  COMPLETED: 'bank_transfer.completed',
  /** The transfer failed; `failureCode` says why. */
  FAILED: 'bank_transfer.failed',
  /** The receiving bank sent a completed transfer back. */
  RETURNED: 'bank_transfer.returned',
});

/** Subscription pattern covering every transfer event. */
const BANK_TRANSFER_EVENT_PATTERN = 'bank_transfer.*';

const BANK_TRANSFER_EVENT_TYPES = Object.freeze(Object.values(BankTransferEvents));

const TRANSFER_BASE = '/api/v1/bank-connect';
const PAGE_QUERY = Object.freeze(['limit', 'cursor']);

/**
 * Transfer and exchange routes — the single source of method, path, body
 * fields, query fields and the Idempotency-Key rule for `BankTransferClient`,
 * `BankFxClient`, the PHP SDK's `BankConnect\BankTransferRoutes` and the
 * Postman lock. Source: gateway
 * bank-connect/transfers/bank-connect-transfer-api.controller.ts and
 * dtos/bank-connect-transfer.dto.ts (forbidNonWhitelisted: any other field is
 * a 400). Every route is signed and needs `bank-connect:transfer` plus a key
 * with an IP allowlist.
 */
const BANK_TRANSFER_ROUTES = Object.freeze({
  listTransferPurposes: Object.freeze({
    method: 'GET', path: `${TRANSFER_BASE}/transfer-purposes`, idempotencyKey: false, query: Object.freeze(['connectionId']),
  }),
  createTransfer: Object.freeze({
    method: 'POST', path: `${TRANSFER_BASE}/transfers`, idempotencyKey: true,
    required: Object.freeze(['accountId', 'receiverIban', 'receiverName', 'amountMinor']),
    optional: Object.freeze(['currency', 'paymentPurpose', 'description']),
  }),
  listTransfers: Object.freeze({
    method: 'GET', path: `${TRANSFER_BASE}/transfers`, idempotencyKey: false,
    query: Object.freeze([...PAGE_QUERY, 'accountId', 'status', 'createdFrom', 'createdTo']),
  }),
  getTransfer: Object.freeze({ method: 'GET', path: `${TRANSFER_BASE}/transfers/:transferId`, idempotencyKey: false }),
  listFxRates: Object.freeze({
    method: 'GET', path: `${TRANSFER_BASE}/fx/rates`, idempotencyKey: false, query: Object.freeze(['connectionId']),
  }),
  createFxQuote: Object.freeze({
    method: 'POST', path: `${TRANSFER_BASE}/fx/quotes`, idempotencyKey: false,
    required: Object.freeze(['sourceAccountId', 'targetAccountId']),
    optional: Object.freeze(['sourceAmountMinor', 'targetAmountMinor']),
  }),
  createFxOrder: Object.freeze({
    method: 'POST', path: `${TRANSFER_BASE}/fx/orders`, idempotencyKey: true,
    required: Object.freeze(['quoteId']),
    optional: Object.freeze(['description']),
  }),
  listFxOrders: Object.freeze({
    method: 'GET', path: `${TRANSFER_BASE}/fx/orders`, idempotencyKey: false, query: Object.freeze([...PAGE_QUERY, 'status']),
  }),
  getFxOrder: Object.freeze({ method: 'GET', path: `${TRANSFER_BASE}/fx/orders/:orderId`, idempotencyKey: false }),
});

/** `Idempotency-Key` of createTransfer / createFxOrder: 8–200 printable ASCII characters. */
const BANK_TRANSFER_IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,200}$/;
/** Longest `description` of a transfer or an exchange order. */
const BANK_TRANSFER_DESCRIPTION_MAX = 140;
/** `receiverName` length range (characters). */
const BANK_TRANSFER_RECEIVER_NAME_MIN = 2;
const BANK_TRANSFER_RECEIVER_NAME_MAX = 140;
/** Longest `receiverIban` the gateway accepts (spaces included); the service checks TR IBAN mod-97. */
const BANK_TRANSFER_IBAN_MAX = 42;
/** `paymentPurpose`: a code from listTransferPurposes(). */
const BANK_TRANSFER_PAYMENT_PURPOSE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/** Query filters each list route accepts (the gateway rejects any other with 400). */
const BANK_CONNECT_FILTERS = Object.freeze({
  listBanks: Object.freeze(['limit', 'cursor']),
  listConnections: Object.freeze(['limit', 'cursor', 'status', 'bankId']),
  listAccounts: Object.freeze(['limit', 'cursor', 'connectionId', 'bankId', 'currency', 'status']),
  listBalances: Object.freeze(['limit', 'cursor', 'accountId', 'currency']),
  listTransactions: Object.freeze([
    'limit', 'cursor', 'accountId', 'bookedFrom', 'bookedTo', 'direction',
    'minAmountMinor', 'maxAmountMinor', 'canonicalType',
  ]),
});

/** Largest page (`limit` 1–100; the gateway's default is 25). */
const BANK_CONNECT_MAX_LIMIT = 100;
/** Most account ids one `accountId` filter may carry. */
const BANK_CONNECT_MAX_ACCOUNT_FILTER = 100;
/** Widest `bookedFrom` … `bookedTo` window of one transaction request, in days. */
const BANK_CONNECT_BOOKED_RANGE_MAX_DAYS = 92;

module.exports = {
  BankConnectionStatus,
  BankAccountStatus,
  BankTransactionDirection,
  BankTransactionType,
  BankAvailability,
  BankCapability,
  BankSyncStatus,
  BankConnectEvents,
  BANK_CONNECT_EVENT_PATTERN,
  BANK_CONNECT_EVENT_TYPES,
  BANK_CONNECT_FILTERS,
  BANK_CONNECT_MAX_LIMIT,
  BANK_CONNECT_MAX_ACCOUNT_FILTER,
  BANK_CONNECT_BOOKED_RANGE_MAX_DAYS,
  BankTransferStatus,
  BankTransferRail,
  BankTransferInitiatedVia,
  BankFxOrderStatus,
  BankFxRequestedSide,
  BankTransferEvents,
  BANK_TRANSFER_EVENT_PATTERN,
  BANK_TRANSFER_EVENT_TYPES,
  BANK_TRANSFER_ROUTES,
  BANK_TRANSFER_IDEMPOTENCY_KEY_PATTERN,
  BANK_TRANSFER_DESCRIPTION_MAX,
  BANK_TRANSFER_RECEIVER_NAME_MIN,
  BANK_TRANSFER_RECEIVER_NAME_MAX,
  BANK_TRANSFER_IBAN_MAX,
  BANK_TRANSFER_PAYMENT_PURPOSE_PATTERN,
};
