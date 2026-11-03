'use strict';

/**
 * Physical POS values, request fields and filters (`/api/v1/physical-pos`).
 *
 * Statuses and operations are open sets on the wire: the SDK lists the values
 * the gateway sends today and never rejects one it does not know. The field
 * and filter lists are closed: the gateway rejects an unknown body field or
 * query parameter with 400, so the SDK checks them before sending.
 */

const PhysicalPosPaymentOperation = Object.freeze({
  SALE: 'SALE',
  PREAUTH_OPEN: 'PREAUTH_OPEN',
  REFUND_UNMATCHED: 'REFUND_UNMATCHED',
  VOID: 'VOID',
  REFUND: 'REFUND',
  PREAUTH_CLOSE: 'PREAUTH_CLOSE',
  PREAUTH_CANCEL: 'PREAUTH_CANCEL',
});

const PhysicalPosPaymentStatus = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
});

const PhysicalPosReversalStatus = Object.freeze({
  NONE: 'NONE',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  VOIDED: 'VOIDED',
  PREAUTH_CLOSED: 'PREAUTH_CLOSED',
  PREAUTH_CANCELLED: 'PREAUTH_CANCELLED',
  PREAUTH_EXPIRED: 'PREAUTH_EXPIRED',
});

/**
 * Webhook event types. `physical_pos.payment.created` and `.in_progress` are
 * internal and never delivered. Reversals (void, refund, pre-authorisation
 * close / cancel) use the same payment events; tell them apart with
 * `data.operation` and `data.rootPaymentId`, and the original payment's source
 * with `data.original.origin`.
 *
 * `PAYMENT_DEVICE_SALE` reports a sale made directly on the device
 * (`origin: "DEVICE_DIRECT"`): it arrives approved, with `deviceOccurredAt`;
 * no `approved` event is sent for it. Its refund comes with the usual payment
 * events (`data.original.origin: "DEVICE_DIRECT"`).
 *
 * End-of-day events (`physical_pos.settlement.*`) have their own payloads:
 * `completed` (the device's result with its bank lines; any source),
 * `failed` (a scheduled run could not finish in its window), `skipped` (a
 * scheduled run was skipped for a reason you can fix) and `overdue` (no
 * result within the policy's threshold). They carry no `historySeq`;
 * deduplicate by the event id.
 */
const PhysicalPosEvents = Object.freeze({
  PAYMENT_APPROVED: 'physical_pos.payment.approved',
  PAYMENT_PARTIALLY_APPROVED: 'physical_pos.payment.partially_approved',
  PAYMENT_DECLINED: 'physical_pos.payment.declined',
  PAYMENT_CANCELLED: 'physical_pos.payment.cancelled',
  PAYMENT_EXPIRED: 'physical_pos.payment.expired',
  PAYMENT_FAILED: 'physical_pos.payment.failed',
  PAYMENT_UNKNOWN: 'physical_pos.payment.unknown',
  PAYMENT_MANUAL_REVIEW: 'physical_pos.payment.manual_review',
  PAYMENT_DEVICE_SALE: 'physical_pos.payment.device_sale',
  FISCAL_DOCUMENT_ISSUED: 'physical_pos.fiscal_document.issued',
  FISCAL_DOCUMENT_FAILED: 'physical_pos.fiscal_document.failed',
  FISCAL_DOCUMENT_CANCELLED: 'physical_pos.fiscal_document.cancelled',
  FISCAL_DOCUMENT_ACTION_REQUIRED: 'physical_pos.fiscal_document.action_required',
  SETTLEMENT_COMPLETED: 'physical_pos.settlement.completed',
  SETTLEMENT_FAILED: 'physical_pos.settlement.failed',
  SETTLEMENT_OVERDUE: 'physical_pos.settlement.overdue',
  SETTLEMENT_SKIPPED: 'physical_pos.settlement.skipped',
});

const PHYSICAL_POS_EVENT_PATTERN = 'physical_pos.*';
const PHYSICAL_POS_EVENT_TYPES = Object.freeze(Object.values(PhysicalPosEvents));

/** `Idempotency-Key`: 8–200 printable ASCII characters, no space. */
const PHYSICAL_POS_IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,200}$/;
const PHYSICAL_POS_MAX_LIMIT = 100;
const PHYSICAL_POS_ROW_VERSION_MAX = 2147483647;

/**
 * 5xx codes after which the gateway guarantees nothing was written (the
 * payment did not start). Any other 5xx, and a request without an HTTP answer,
 * leaves the outcome of a payment write unknown.
 */
const PHYSICAL_POS_NOT_STARTED_CODES = Object.freeze([
  'physical_pos.presence.unavailable',
  'physical_pos.signing.unavailable',
  'physical_pos.service.busy',
  'physical_pos.service.clock_skew',
  'physical_pos.service.not_configured',
]);

const PAYMENT_TARGET_FIELDS = Object.freeze(['deviceId', 'vendorCode', 'serialNumber', 'externalRef']);
const SALE_ITEM_FIELDS = Object.freeze([
  'lineNo', 'name', 'quantityMilli', 'unitCode', 'unitPriceMinor', 'taxGroupCode', 'lineTotalMinor', 'barcode',
]);
const REFUND_ITEM_FIELDS = Object.freeze(['lineNo', 'quantityMilli', 'amountMinor']);

/**
 * Request bodies: `{ field: kind }`. Kinds: `string`, `int`, `money`, `bool`,
 * `strings` (array of strings), `rowVersion`, `target`, `saleItems`,
 * `refundItems`. A `*` suffix marks a required field; `?` allows `null`.
 */
const PHYSICAL_POS_REQUEST_FIELDS = Object.freeze({
  createPayment: Object.freeze({
    operation: 'string*',
    target: 'target*',
    amountMinor: 'money*',
    currency: 'string*',
    installmentCount: 'int?',
    instrument: 'string?',
    merchantReference: 'string?',
    allowDuplicateReference: 'bool',
    startTimeoutSeconds: 'int?',
    terminalAcquirerId: 'string?',
    items: 'saleItems',
    interaction: 'string?',
    terminalProviderId: 'string?',
  }),
  createReversal: Object.freeze({
    operation: 'string*',
    amountMinor: 'money',
    currency: 'string*',
    merchantReference: 'string?',
    startTimeoutSeconds: 'int?',
    target: 'target?',
    items: 'refundItems',
  }),
  createStore: Object.freeze({
    code: 'string*', name: 'string*', city: 'string', district: 'string', addressLine: 'string', timezone: 'string', externalRef: 'string',
  }),
  updateStore: Object.freeze({
    rowVersion: 'rowVersion*', name: 'string', city: 'string?', district: 'string?', addressLine: 'string?', timezone: 'string', externalRef: 'string?',
  }),
  statusChange: Object.freeze({ rowVersion: 'rowVersion*', reasonCode: 'string*' }),
  createRegister: Object.freeze({ code: 'string*', name: 'string*' }),
  updateRegister: Object.freeze({ rowVersion: 'rowVersion*', name: 'string' }),
  createTerminal: Object.freeze({
    code: 'string*', displayName: 'string*', vendorCode: 'string', virtualSerial: 'string', vendorTerminalRef: 'string',
  }),
  updateTerminal: Object.freeze({ rowVersion: 'rowVersion*', displayName: 'string', vendorCode: 'string' }),
  addTerminalAcquirer: Object.freeze({
    vendorAcquirerRef: 'string*', merchantNumber: 'string*', terminalNumber: 'string*', label: 'string', currencies: 'strings*',
  }),
  updateTerminalAcquirer: Object.freeze({ rowVersion: 'rowVersion*', label: 'string?', currencies: 'strings', status: 'string' }),
  addTerminalProvider: Object.freeze({
    vendorAccountId: 'string*', merchantCode: 'string*', terminalCode: 'string*', productCode: 'string', label: 'string',
  }),
  updateTerminalProvider: Object.freeze({ rowVersion: 'rowVersion*', label: 'string?', status: 'string' }),
  changeTerminalDevice: Object.freeze({ rowVersion: 'rowVersion*', deviceId: 'string*', reasonCode: 'string*' }),
  createDevice: Object.freeze({
    vendorCode: 'string*',
    deviceModelId: 'string*',
    serialNumber: 'string*',
    displayName: 'string',
    externalRef: 'string',
    storeId: 'string',
    registerId: 'string',
    integrationChannel: 'string*',
    channelVariant: 'string',
    appMode: 'string',
  }),
  updateDevice: Object.freeze({
    rowVersion: 'rowVersion*', displayName: 'string?', externalRef: 'string?', integrationChannel: 'string', channelVariant: 'string?', appMode: 'string?',
  }),
  assignDevice: Object.freeze({ rowVersion: 'rowVersion*', storeId: 'string*', registerId: 'string?', reasonCode: 'string*' }),
  changeDeviceLifecycle: Object.freeze({ rowVersion: 'rowVersion*', target: 'string*', reasonCode: 'string*' }),
  revokeDeviceKey: Object.freeze({ rowVersion: 'rowVersion*', reasonCode: 'string*' }),
  revertDeviceEnrollment: Object.freeze({ reasonCode: 'string*' }),
  revokeActivationCode: Object.freeze({ reasonCode: 'string*' }),
  setSettlementPolicy: Object.freeze({
    mode: 'string*',
    scheduleTime: 'string',
    timeZone: 'string',
    scheduleDays: 'strings',
    retryWindowMinutes: 'int',
    retryIntervalMinutes: 'int',
    offlineBehavior: 'string',
    overdueAlertHours: 'int',
    expectedRowVersion: 'rowVersion',
  }),
});

const PAGE = ['limit', 'cursor'];
const ENTITY_PAGE = [...PAGE, 'includeTotal'];
const REPORT = ['dateFrom', 'dateTo', 'deviceId', 'storeId'];

/** Query parameters per route; anything else is rejected before sending. */
const PHYSICAL_POS_FILTERS = Object.freeze({
  listPayments: Object.freeze([...PAGE, 'deviceId', 'paymentStatus', 'createdFrom', 'createdTo', 'merchantReference']),
  listTransactions: Object.freeze([
    ...PAGE, 'deviceId', 'storeId', 'registerId', 'paymentStatus', 'createdFrom', 'createdTo', 'merchantReference',
    'amountFromMinor', 'amountToMinor', 'origin', 'operation',
  ]),
  listAmbiguousPayments: Object.freeze([...PAGE, 'deviceId', 'paymentStatus']),
  getSalesSummary: Object.freeze([...REPORT, 'groupBy']),
  getTaxSummary: Object.freeze([...REPORT]),
  listSettlements: Object.freeze([...PAGE, 'deviceId', 'lineStatus', 'createdFrom', 'createdTo']),
  listSettlementRuns: Object.freeze([...ENTITY_PAGE, 'deviceId', 'source', 'runStatus', 'createdFrom', 'createdTo']),
  listDeviceModels: Object.freeze(['vendorCode', 'deviceType', 'status']),
  listStores: Object.freeze([...ENTITY_PAGE, 'status', 'q']),
  listRegisters: Object.freeze([...ENTITY_PAGE, 'status']),
  listTerminals: Object.freeze([...ENTITY_PAGE, 'status', 'q']),
  listTerminalAcquirers: Object.freeze([...ENTITY_PAGE]),
  listTerminalProviders: Object.freeze([...ENTITY_PAGE]),
  listDevices: Object.freeze([
    ...ENTITY_PAGE, 'storeId', 'registerId', 'vendorCode', 'deviceModelId', 'deviceType', 'lifecycleStatus',
    'ownershipStatus', 'integrationChannel', 'q',
  ]),
  history: Object.freeze([...PAGE]),
});

module.exports = {
  PhysicalPosPaymentOperation,
  PhysicalPosPaymentStatus,
  PhysicalPosReversalStatus,
  PhysicalPosEvents,
  PHYSICAL_POS_EVENT_PATTERN,
  PHYSICAL_POS_EVENT_TYPES,
  PHYSICAL_POS_IDEMPOTENCY_KEY_PATTERN,
  PHYSICAL_POS_MAX_LIMIT,
  PHYSICAL_POS_ROW_VERSION_MAX,
  PHYSICAL_POS_NOT_STARTED_CODES,
  PAYMENT_TARGET_FIELDS,
  SALE_ITEM_FIELDS,
  REFUND_ITEM_FIELDS,
  PHYSICAL_POS_REQUEST_FIELDS,
  PHYSICAL_POS_FILTERS,
};
