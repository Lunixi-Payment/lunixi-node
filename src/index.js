'use strict';

const { Configuration } = require('./configuration');
const { ApiClient } = require('./api-client');
const { Ed25519Signer } = require('./auth/ed25519-signer');
const { TokenManager, InMemoryTokenStore } = require('./auth/token-manager');
const { WebhookVerifier } = require('./webhook/webhook-verifier');
const { PaymentClient } = require('./payment/payment-client');
const { PaymentLinkClient } = require('./payment/payment-link-client');
const paymentLinkValues = require('./payment/payment-link-values');
const paymentMethodValues = require('./payment/payment-method-values');
const promissoryNoteValues = require('./payment/promissory-note-values');
const splitPaymentValues = require('./payment/split-payment-values');
const { SplitPaymentRequest } = require('./payment/split-payment-request');
const { ReferenceClient } = require('./reference/reference-client');
const { InsuranceItemCategory } = require('./payment/basket-item-values');
const { FraudClient } = require('./fraud/fraud-client');
const { WalletClient } = require('./wallet/wallet-client');
const walletValues = require('./wallet/wallet-values');
const { BankConnectClient } = require('./bank-connect/bank-connect-client');
const { BankTransferClient, BankFxClient } = require('./bank-connect/bank-transfer-client');
const bankConnectValues = require('./bank-connect/bank-connect-values');
const { SanctionClient } = require('./sanction/sanction-client');
const sanctionValues = require('./sanction/sanction-values');
const { InsuranceClient } = require('./insurance/insurance-client');
const insuranceValues = require('./insurance/insurance-values');
const fraudTaxonomy = require('./fraud/taxonomy');
const { FraudEvents, FRAUD_EVENT_TYPES, FraudDecisionValue, FRAUD_DECISION_VALUES } = require('./fraud/fraud-events');
const { ALLOWED_FIELDS: FRAUD_EVALUATE_FIELDS } = require('./fraud/evaluate-request');
const {
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectMethodPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  CreatePaymentLinkRequest,
  REMOVED_AMOUNT_FIELDS,
} = require('./payment/dto');
const errors = require('./errors');

class LunixiClient {
  constructor(options = {}) {
    this.config = new Configuration(options);
    this.signer = new Ed25519Signer(this.config.privateKey);
    this.tokens = new TokenManager(this.config, this.signer, options.tokenStore || new InMemoryTokenStore());
    this.api = new ApiClient(this.config, this.signer, this.tokens);
    this.payments = new PaymentClient(this.api);
    this.paymentLinks = new PaymentLinkClient(this.api);
    this.fraud = new FraudClient(this.api);
    this.wallet = new WalletClient(this.api);
    this.bankConnect = new BankConnectClient(this.api);
    this.sanction = new SanctionClient(this.api);
    this.reference = new ReferenceClient(this.api);
    this.insurance = new InsuranceClient(this.api);
  }

  static generateKeyPair() {
    return Ed25519Signer.generateKeyPair();
  }

  publicKeyPem() {
    return this.signer.publicKeyPem();
  }
}

module.exports = {
  LunixiClient,
  Configuration,
  ApiClient,
  Ed25519Signer,
  TokenManager,
  InMemoryTokenStore,
  WebhookVerifier,
  PaymentClient,
  PaymentLinkClient,
  FraudClient,
  WalletClient,
  BankConnectClient,
  BankTransferClient,
  BankFxClient,
  SanctionClient,
  ReferenceClient,
  InsuranceClient,
  FraudEvents,
  FRAUD_EVENT_TYPES,
  FraudDecisionValue,
  FRAUD_DECISION_VALUES,
  FRAUD_EVALUATE_FIELDS,
  fraud: fraudTaxonomy,
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  InsuranceItemCategory,
  CreateIntentRequest,
  DirectMethodPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  SplitPaymentRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  CreatePaymentLinkRequest,
  REMOVED_AMOUNT_FIELDS,
  PaymentMethod: paymentMethodValues.PaymentMethod,
  PaymentActionType: paymentMethodValues.PaymentActionType,
  ProviderSelection: paymentMethodValues.ProviderSelection,
  ProviderSelectionMode: paymentMethodValues.ProviderSelectionMode,
  MethodInputFieldType: paymentMethodValues.MethodInputFieldType,
  DIRECT_METHOD_PAYMENT_FIELDS: paymentMethodValues.DIRECT_METHOD_PAYMENT_FIELDS,
  PAYMENT_ACTION_CONFIRM_FIELDS: paymentMethodValues.PAYMENT_ACTION_CONFIRM_FIELDS,
  PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS: promissoryNoteValues.PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS,
  PromissoryNoteStatus: promissoryNoteValues.PromissoryNoteStatus,
  PromissoryNoteDocumentType: promissoryNoteValues.PromissoryNoteDocumentType,
  PromissoryNoteCancelResult: promissoryNoteValues.PromissoryNoteCancelResult,
  PromissoryNoteCancelErrorCode: promissoryNoteValues.PromissoryNoteCancelErrorCode,
  PromissoryNoteDocumentLocale: promissoryNoteValues.PromissoryNoteDocumentLocale,
  PromissoryNoteEvents: promissoryNoteValues.PromissoryNoteEvents,
  SplitBehavior: splitPaymentValues.SplitBehavior,
  SplitPaymentStatus: splitPaymentValues.SplitPaymentStatus,
  SPLIT_PAYMENT_IN_PROGRESS_STATUSES: splitPaymentValues.SPLIT_PAYMENT_IN_PROGRESS_STATUSES,
  SplitLegStatus: splitPaymentValues.SplitLegStatus,
  SplitStepKind: splitPaymentValues.SplitStepKind,
  SplitPendingStep: splitPaymentValues.SplitPendingStep,
  SplitLegRefundState: splitPaymentValues.SplitLegRefundState,
  SplitRefundStatus: splitPaymentValues.SplitRefundStatus,
  SplitRefundLegStatus: splitPaymentValues.SplitRefundLegStatus,
  PaymentSplitRole: splitPaymentValues.PaymentSplitRole,
  SplitReconciliationReason: splitPaymentValues.SplitReconciliationReason,
  SplitPaymentEvents: splitPaymentValues.SplitPaymentEvents,
  SPLIT_LEG_EVENTS_SUBSCRIPTION: splitPaymentValues.SPLIT_LEG_EVENTS_SUBSCRIPTION,
  SplitPayErrorCode: splitPaymentValues.SplitPayErrorCode,
  CheckoutFormErrorCode: splitPaymentValues.CheckoutFormErrorCode,
  ThreeDsDisplay: splitPaymentValues.ThreeDsDisplay,
  SplitCompletionOutcome: splitPaymentValues.SplitCompletionOutcome,
  SPLIT_PAYMENT_FIELDS: splitPaymentValues.SPLIT_PAYMENT_FIELDS,
  SPLIT_PAYMENT_LEG_FIELDS: splitPaymentValues.SPLIT_PAYMENT_LEG_FIELDS,
  SPLIT_MAX_LEGS: splitPaymentValues.SPLIT_MAX_LEGS,
  PaymentLinkUsage: paymentLinkValues.PaymentLinkUsage,
  PaymentLinkAmountMode: paymentLinkValues.PaymentLinkAmountMode,
  PaymentLinkState: paymentLinkValues.PaymentLinkState,
  PaymentLinkAttemptState: paymentLinkValues.PaymentLinkAttemptState,
  PaymentLinkEnvironment: paymentLinkValues.PaymentLinkEnvironment,
  BuyerFieldRequirement: paymentLinkValues.BuyerFieldRequirement,
  CustomFieldType: paymentLinkValues.CustomFieldType,
  PaymentLinkButtonLabel: paymentLinkValues.PaymentLinkButtonLabel,
  PaymentLinkDeliveryChannel: paymentLinkValues.PaymentLinkDeliveryChannel,
  PaymentLinkQrFormat: paymentLinkValues.PaymentLinkQrFormat,
  PaymentLinkLocale: paymentLinkValues.PaymentLinkLocale,
  PaymentLinkImageContentType: paymentLinkValues.PaymentLinkImageContentType,
  PAYMENT_LINK_SPEC_FIELDS: paymentLinkValues.PAYMENT_LINK_SPEC_FIELDS,
  WalletAccountType: walletValues.WalletAccountType,
  WalletEndUserStatus: walletValues.WalletEndUserStatus,
  WalletKycLevel: walletValues.WalletKycLevel,
  WalletOtpChannel: walletValues.WalletOtpChannel,
  WalletQrType: walletValues.WalletQrType,
  WalletQrImageFormat: walletValues.WalletQrImageFormat,
  WalletBulkTargetType: walletValues.WalletBulkTargetType,
  WalletCorporateAccountStatus: walletValues.WalletCorporateAccountStatus,
  WALLET_ROUTES: walletValues.WALLET_ROUTES,
  BankConnectionStatus: bankConnectValues.BankConnectionStatus,
  BankAccountStatus: bankConnectValues.BankAccountStatus,
  BankTransactionDirection: bankConnectValues.BankTransactionDirection,
  BankTransactionType: bankConnectValues.BankTransactionType,
  BankAvailability: bankConnectValues.BankAvailability,
  BankCapability: bankConnectValues.BankCapability,
  BankSyncStatus: bankConnectValues.BankSyncStatus,
  BankConnectEvents: bankConnectValues.BankConnectEvents,
  BANK_CONNECT_EVENT_PATTERN: bankConnectValues.BANK_CONNECT_EVENT_PATTERN,
  BANK_CONNECT_EVENT_TYPES: bankConnectValues.BANK_CONNECT_EVENT_TYPES,
  BANK_CONNECT_FILTERS: bankConnectValues.BANK_CONNECT_FILTERS,
  BankTransferStatus: bankConnectValues.BankTransferStatus,
  BankTransferRail: bankConnectValues.BankTransferRail,
  BankTransferInitiatedVia: bankConnectValues.BankTransferInitiatedVia,
  BankFxOrderStatus: bankConnectValues.BankFxOrderStatus,
  BankFxRequestedSide: bankConnectValues.BankFxRequestedSide,
  BankTransferEvents: bankConnectValues.BankTransferEvents,
  BANK_TRANSFER_EVENT_PATTERN: bankConnectValues.BANK_TRANSFER_EVENT_PATTERN,
  BANK_TRANSFER_EVENT_TYPES: bankConnectValues.BANK_TRANSFER_EVENT_TYPES,
  BANK_TRANSFER_ROUTES: bankConnectValues.BANK_TRANSFER_ROUTES,
  SanctionRiskDomain: sanctionValues.SanctionRiskDomain,
  SanctionScreenMode: sanctionValues.SanctionScreenMode,
  SanctionWalletScreenMode: sanctionValues.SanctionWalletScreenMode,
  SanctionSubjectType: sanctionValues.SanctionSubjectType,
  SanctionCoverageStatus: sanctionValues.SanctionCoverageStatus,
  SanctionHitType: sanctionValues.SanctionHitType,
  SANCTION_ROUTES: sanctionValues.SANCTION_ROUTES,
  isClearScreening: sanctionValues.isClearScreening,
  InsurancePremiumCollectedBy: insuranceValues.InsurancePremiumCollectedBy,
  InsuranceQuoteStatus: insuranceValues.InsuranceQuoteStatus,
  InsuranceOrderStatus: insuranceValues.InsuranceOrderStatus,
  InsuranceCollectionStatus: insuranceValues.InsuranceCollectionStatus,
  InsurancePolicyStatus: insuranceValues.InsurancePolicyStatus,
  InsuranceRefundStatus: insuranceValues.InsuranceRefundStatus,
  InsuranceDocumentStatus: insuranceValues.InsuranceDocumentStatus,
  InsurancePaymentMode: insuranceValues.InsurancePaymentMode,
  InsuranceOrderSurface: insuranceValues.InsuranceOrderSurface,
  InsuranceReferenceKind: insuranceValues.InsuranceReferenceKind,
  InsuranceLeadStatus: insuranceValues.InsuranceLeadStatus,
  InsuranceEvents: insuranceValues.InsuranceEvents,
  INSURANCE_EVENT_PATTERN: insuranceValues.INSURANCE_EVENT_PATTERN,
  INSURANCE_EVENT_TYPES: insuranceValues.INSURANCE_EVENT_TYPES,
  INSURANCE_QUOTE_FIELDS: insuranceValues.INSURANCE_QUOTE_FIELDS,
  INSURANCE_LEAD_FIELDS: insuranceValues.INSURANCE_LEAD_FIELDS,
  INSURANCE_FILTERS: insuranceValues.INSURANCE_FILTERS,
  ...errors,
};
