'use strict';

/**
 * Wallet — the merchant (server-to-server) API surface, `/api/v1/wallet/*`.
 *
 * `WALLET_ROUTES` is the single description of every route the SDK calls: the
 * HTTP method, the path template, whether the gateway requires an
 * `Idempotency-Key`, and the body / query fields the gateway DTO accepts. The
 * client validates against it before sending (the gateway runs with
 * `forbidNonWhitelisted`, so an unknown body key is a 400), and the Postman
 * collection test reads the same table so the two cannot drift.
 *
 * Source of truth: nest-payment-gateway
 *   apps/api-gateway/src/wallet/wallet-api.controller.ts (routes, idempotency)
 *   apps/api-gateway/src/wallet/dto/wallet.dtos.ts       (fields)
 */

const freeze = (value) => Object.freeze(value);

const WalletAccountType = freeze({ PERSONAL: 'PERSONAL', BUSINESS: 'BUSINESS' });
const WalletEndUserStatus = freeze({ ACTIVE: 'ACTIVE', FROZEN: 'FROZEN', CLOSED: 'CLOSED' });
const WalletKycLevel = freeze({ NONE: 'NONE', LOW: 'LOW', SUBSTANTIAL: 'SUBSTANTIAL', HIGH: 'HIGH' });
const WalletOtpChannel = freeze({ EMAIL: 'EMAIL', SMS: 'SMS', PUSH: 'PUSH' });
const WalletQrType = freeze({
  P2P_STATIC: 'P2P_STATIC',
  P2P_DYNAMIC: 'P2P_DYNAMIC',
  MERCHANT_STATIC: 'MERCHANT_STATIC',
  MERCHANT_DYNAMIC: 'MERCHANT_DYNAMIC',
});
const WalletQrImageFormat = freeze({ SVG: 'svg', PNG: 'png' });
const WalletBulkTargetType = freeze({ WALLET: 'WALLET', IBAN: 'IBAN' });
const WalletCorporateAccountStatus = freeze({ ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' });

/** Minor units as a decimal string: `"12550"` is 125.50 TRY. Never a float. */
const AMOUNT_PATTERN = /^\d{1,18}$/;
/** The gateway trims the header and accepts 1-128 characters. */
const WALLET_IDEMPOTENCY_KEY_MAX = 128;

const PAGE_QUERY = ['limit', 'cursor'];

/**
 * @typedef {object} WalletRoute
 * @property {'GET'|'POST'|'PUT'} method
 * @property {string} path            path template; `:name` segments are filled from arguments
 * @property {boolean} idempotencyKey the gateway rejects the call without an `Idempotency-Key`
 * @property {string[]} [required]    body fields the gateway requires
 * @property {string[]} [optional]    other body fields it accepts
 * @property {string[]} [query]       accepted query parameters
 * @property {boolean} [binary]       2xx answer is an image, not the JSON envelope
 */

/** @type {Readonly<Record<string, WalletRoute>>} */
const WALLET_ROUTES = freeze({
  ping: { method: 'GET', path: '/api/v1/wallet/ping', idempotencyKey: false },

  // Programs
  listMyPrograms: { method: 'GET', path: '/api/v1/wallet/programs/me', idempotencyKey: false },
  setCollectionAnchor: {
    method: 'PUT', path: '/api/v1/wallet/programs/:programId/collection-anchor', idempotencyKey: false,
    optional: ['collectionEndUserId', 'reason', 'expectedVersion'],
  },

  // End users
  createEndUser: {
    method: 'POST', path: '/api/v1/wallet/end-users', idempotencyKey: true,
    required: ['programId', 'accountType', 'phone'],
    optional: ['externalCustomerId', 'kycRef', 'kycLevelCache', 'displayName', 'corporateAccountId', 'defaultCurrency'],
  },
  listEndUsers: {
    method: 'GET', path: '/api/v1/wallet/end-users', idempotencyKey: false,
    query: ['programId', 'accountType', 'status', 'corporateAccountId', 'merchantCategoryState', ...PAGE_QUERY],
  },
  getEndUserByExternalId: {
    method: 'GET', path: '/api/v1/wallet/end-users/by-external/:externalCustomerId', idempotencyKey: false,
    query: ['programId'],
  },
  getEndUser: { method: 'GET', path: '/api/v1/wallet/end-users/:endUserId', idempotencyKey: false },
  freezeEndUser: {
    method: 'POST', path: '/api/v1/wallet/end-users/:endUserId/freeze', idempotencyKey: true,
    optional: ['reason'],
  },
  getBalances: { method: 'GET', path: '/api/v1/wallet/end-users/:endUserId/balances', idempotencyKey: false },
  getKycLevel: { method: 'GET', path: '/api/v1/wallet/end-users/:endUserId/kyc-level', idempotencyKey: false },
  updateKycLevel: {
    method: 'PUT', path: '/api/v1/wallet/end-users/:endUserId/kyc-level', idempotencyKey: true,
    required: ['kycLevel', 'sourceRef'],
    optional: ['externalCustomerId', 'programId', 'reason', 'effectiveAt', 'expectedCurrentLevel'],
  },
  getLimits: {
    method: 'GET', path: '/api/v1/wallet/end-users/:endUserId/limits', idempotencyKey: false,
    query: ['operationType', 'currency'],
  },
  createWallet: {
    method: 'POST', path: '/api/v1/wallet/end-users/:endUserId/wallets', idempotencyKey: true,
    optional: ['name', 'currencies'],
  },

  // Wallets and accounts
  createWalletAccount: {
    method: 'POST', path: '/api/v1/wallet/wallets/:walletId/accounts', idempotencyKey: true,
    required: ['currency'],
  },
  lookupWallet: {
    method: 'POST', path: '/api/v1/wallet/wallets/lookup', idempotencyKey: false,
    optional: ['programId', 'phone', 'walletNo'],
  },

  // Deposits (bank transfer in)
  listDepositInstructions: {
    method: 'GET', path: '/api/v1/wallet/end-users/:endUserId/deposit-instructions', idempotencyKey: false,
  },
  createDepositInstruction: {
    method: 'POST', path: '/api/v1/wallet/end-users/:endUserId/deposit-instructions', idempotencyKey: false,
    required: ['walletAccountId'], optional: ['currency'],
  },
  simulateInboundCredit: {
    method: 'POST', path: '/api/v1/wallet/bank-integrations/inbound-credits', idempotencyKey: false,
    required: ['programId', 'railId', 'amount', 'currency', 'rawReference'],
    optional: ['senderName', 'senderIban', 'creditedIban', 'receiptNumber'],
  },

  // Corporate accounts
  createCorporateAccount: {
    method: 'POST', path: '/api/v1/wallet/corporate-accounts', idempotencyKey: true,
    required: ['programId', 'code', 'name', 'ownerEndUserId'], optional: ['fundingCurrency'],
  },
  listCorporateAccounts: {
    method: 'GET', path: '/api/v1/wallet/corporate-accounts', idempotencyKey: false,
    query: ['programId', 'status', ...PAGE_QUERY],
  },
  importCorporateEmployees: {
    method: 'POST', path: '/api/v1/wallet/corporate-accounts/:corporateAccountId/employees/import', idempotencyKey: true,
    required: ['rows'],
  },
  offboardCorporateEmployees: {
    method: 'POST', path: '/api/v1/wallet/corporate-accounts/:corporateAccountId/employees/offboard', idempotencyKey: true,
    required: ['rows'], optional: ['reason'],
  },

  // Fees
  quoteFees: {
    method: 'POST', path: '/api/v1/wallet/fees/quote', idempotencyKey: false,
    required: ['programId', 'operationType', 'currency', 'amount'], optional: ['at'],
  },

  // Wallet-to-wallet transfers
  quoteW2W: {
    method: 'POST', path: '/api/v1/wallet/transfers/w2w/quote', idempotencyKey: false,
    required: ['endUserId', 'sourceWalletAccountId', 'amount', 'currency'],
    optional: ['destinationWalletNo', 'destinationPhone', 'paymentPurpose'],
  },
  initiateW2W: {
    method: 'POST', path: '/api/v1/wallet/transfers/w2w', idempotencyKey: true,
    required: ['endUserId', 'sourceWalletAccountId', 'amount', 'currency'],
    optional: ['destinationWalletNo', 'destinationPhone', 'paymentPurpose', 'scheduleVersionId', 'otpDestination', 'otpChannel', 'locale'],
  },
  completeW2W: {
    method: 'POST', path: '/api/v1/wallet/transfers/w2w/:operationId/complete', idempotencyKey: true,
    required: ['endUserId', 'operationId', 'integrityHash', 'nonce'], optional: ['otpCode', 'trustedActionToken'],
  },

  // Transfers to an IBAN
  quoteW2Iban: {
    method: 'POST', path: '/api/v1/wallet/transfers/w2iban/quote', idempotencyKey: false,
    required: ['endUserId', 'sourceWalletAccountId', 'beneficiaryName', 'iban', 'amount', 'currency'],
    optional: ['bankCode', 'paymentPurpose'],
  },
  initiateW2Iban: {
    method: 'POST', path: '/api/v1/wallet/transfers/w2iban', idempotencyKey: true,
    required: ['endUserId', 'sourceWalletAccountId', 'beneficiaryName', 'iban', 'amount', 'currency'],
    optional: ['bankCode', 'paymentPurpose', 'scheduleVersionId', 'otpDestination', 'otpChannel', 'locale'],
  },
  completeW2Iban: {
    method: 'POST', path: '/api/v1/wallet/transfers/w2iban/:operationId/complete', idempotencyKey: true,
    required: ['endUserId', 'operationId', 'integrityHash', 'nonce'], optional: ['otpCode', 'trustedActionToken'],
  },

  // Withdrawals to the end user's own bank account
  quoteBankWithdrawal: {
    method: 'POST', path: '/api/v1/wallet/withdrawals/bank/quote', idempotencyKey: false,
    required: ['endUserId', 'sourceWalletAccountId', 'beneficiaryName', 'iban', 'amount', 'currency'],
    optional: ['bankCode', 'paymentPurpose'],
  },
  initiateBankWithdrawal: {
    method: 'POST', path: '/api/v1/wallet/withdrawals/bank', idempotencyKey: true,
    required: ['endUserId', 'sourceWalletAccountId', 'beneficiaryName', 'iban', 'amount', 'currency'],
    optional: ['bankCode', 'paymentPurpose', 'scheduleVersionId', 'otpDestination', 'otpChannel', 'locale'],
  },
  completeBankWithdrawal: {
    method: 'POST', path: '/api/v1/wallet/withdrawals/bank/:operationId/complete', idempotencyKey: true,
    required: ['endUserId', 'operationId', 'integrityHash', 'nonce'], optional: ['otpCode', 'trustedActionToken'],
  },
  getWithdrawal: { method: 'GET', path: '/api/v1/wallet/withdrawals/:operationId', idempotencyKey: false },

  // Operations
  listOperations: {
    method: 'GET', path: '/api/v1/wallet/operations', idempotencyKey: false,
    query: ['endUserId', 'walletAccountId', 'status', 'operationType', 'destinationWalletAccountId', ...PAGE_QUERY],
  },
  getOperation: { method: 'GET', path: '/api/v1/wallet/operations/:operationId', idempotencyKey: false },
  getOperationReceipt: { method: 'GET', path: '/api/v1/wallet/operations/:operationId/receipt', idempotencyKey: false },

  // Top-ups
  startCardTopup: {
    method: 'POST', path: '/api/v1/wallet/topups/card', idempotencyKey: true,
    required: ['creditWalletAccountId', 'amount', 'currency'],
    optional: ['fundingMerchantId', 'savedCardUserKey', 'savedCardToken', 'savedConsumerToken', 'savedPublicCardStorageToken', 'returnUrl'],
  },
  getTopup: { method: 'GET', path: '/api/v1/wallet/topups/:operationId', idempotencyKey: false },
  refundTopup: {
    method: 'POST', path: '/api/v1/wallet/topups/:operationId/refund', idempotencyKey: false,
    // The gateway DTO marks approverPrincipal optional, but wallet-service refuses
    // the refund without it (400 WALLET_VALIDATION): it is required in practice.
    required: ['reason', 'requesterPrincipal', 'approverPrincipal'],
  },
  agentTopup: {
    method: 'POST', path: '/api/v1/wallet/agent-topups', idempotencyKey: true,
    required: ['agentId', 'creditWalletAccountId', 'amount', 'currency'],
  },

  // Payments to the merchant (Wallet2Buy, payment code)
  requestPayment: {
    method: 'POST', path: '/api/v1/wallet/payments/buy', idempotencyKey: true,
    required: ['amount', 'currency', 'paymentPurpose'],
    optional: ['buyerWalletNo', 'buyerPhone', 'orderRef', 'cashierRef', 'otpDestination', 'otpChannel', 'locale'],
  },
  approvePayment: {
    method: 'POST', path: '/api/v1/wallet/payments/:operationId/approve', idempotencyKey: true,
    required: ['buyerEndUserId', 'integrityHash', 'nonce'], optional: ['otpCode', 'trustedActionToken'],
  },
  collectByCode: {
    method: 'POST', path: '/api/v1/wallet/collect', idempotencyKey: true,
    required: ['code', 'amount', 'currency'], optional: ['orderRef', 'paymentPurpose', 'locale'],
  },
  getPayment: { method: 'GET', path: '/api/v1/wallet/payments/:operationId', idempotencyKey: false },
  getBusinessCommission: {
    method: 'GET', path: '/api/v1/wallet/business-accounts/:businessAccountId/commission', idempotencyKey: false,
  },

  // QR codes
  createQr: {
    method: 'POST', path: '/api/v1/wallet/qr', idempotencyKey: true,
    required: ['qrType', 'currency'],
    optional: ['targetEndUserId', 'targetExternalCustomerId', 'programId', 'amount', 'expiresInSeconds', 'metadata'],
  },
  listQr: {
    method: 'GET', path: '/api/v1/wallet/qr', idempotencyKey: false,
    query: ['programId', 'qrType', 'status', 'targetEndUserId', ...PAGE_QUERY],
  },
  getQr: { method: 'GET', path: '/api/v1/wallet/qr/:qrId', idempotencyKey: false },
  getQrImage: {
    method: 'GET', path: '/api/v1/wallet/qr/:qrId/image', idempotencyKey: false, binary: true,
    query: ['format', 'scale'],
  },
  revokeQr: { method: 'POST', path: '/api/v1/wallet/qr/:qrId/revoke', idempotencyKey: false },
  parseQr: { method: 'POST', path: '/api/v1/wallet/qr/parse', idempotencyKey: false, required: ['payload'] },

  // Bulk payouts
  createBulkPayout: {
    method: 'POST', path: '/api/v1/wallet/bulk-payouts', idempotencyKey: true,
    required: ['programId', 'sourceWalletAccountId', 'currency', 'items'], optional: ['reason'],
  },
  listBulkPayouts: {
    method: 'GET', path: '/api/v1/wallet/bulk-payouts', idempotencyKey: false,
    query: ['programId', 'status', 'limit'],
  },
  getBulkPayout: { method: 'GET', path: '/api/v1/wallet/bulk-payouts/:batchId', idempotencyKey: false },
  listBulkPayoutItems: {
    method: 'GET', path: '/api/v1/wallet/bulk-payouts/:batchId/items', idempotencyKey: false,
    query: ['status', 'limit'],
  },
  submitBulkPayout: { method: 'POST', path: '/api/v1/wallet/bulk-payouts/:batchId/submit', idempotencyKey: false },
  approveBulkPayout: {
    method: 'POST', path: '/api/v1/wallet/bulk-payouts/:batchId/approve', idempotencyKey: false,
    required: ['approve'], optional: ['reason'],
  },
  rejectBulkPayout: {
    method: 'POST', path: '/api/v1/wallet/bulk-payouts/:batchId/reject', idempotencyKey: false,
    optional: ['reason'],
  },
  processBulkPayout: { method: 'POST', path: '/api/v1/wallet/bulk-payouts/:batchId/process', idempotencyKey: false },
  retryFailedBulkPayout: {
    method: 'POST', path: '/api/v1/wallet/bulk-payouts/:batchId/retry-failed', idempotencyKey: false,
  },
});

/** Body fields that carry a minor-unit amount string. */
const WALLET_AMOUNT_FIELDS = freeze(['amount']);

/** Fields of the nested rows/items the gateway validates element by element. */
const WALLET_NESTED_FIELDS = freeze({
  importCorporateEmployees: freeze({ required: ['phone'], optional: ['displayName', 'externalCustomerId', 'kycRef'] }),
  offboardCorporateEmployees: freeze({ required: [], optional: ['endUserId', 'externalCustomerId'] }),
  createBulkPayout: freeze({ required: ['targetType', 'targetRef', 'amount'], optional: ['beneficiaryName'] }),
});

module.exports = {
  WalletAccountType,
  WalletEndUserStatus,
  WalletKycLevel,
  WalletOtpChannel,
  WalletQrType,
  WalletQrImageFormat,
  WalletBulkTargetType,
  WalletCorporateAccountStatus,
  WALLET_ROUTES,
  WALLET_AMOUNT_FIELDS,
  WALLET_NESTED_FIELDS,
  WALLET_IDEMPOTENCY_KEY_MAX,
  AMOUNT_PATTERN,
};
