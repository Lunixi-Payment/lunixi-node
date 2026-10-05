'use strict';

const { Configuration } = require('./configuration');
const { ApiClient } = require('./api-client');
const { Ed25519Signer } = require('./auth/ed25519-signer');
const { TokenManager, InMemoryTokenStore } = require('./auth/token-manager');
const { WebhookVerifier } = require('./webhook/webhook-verifier');
const { PaymentClient } = require('./payment/payment-client');
const { PaymentLinkClient } = require('./payment/payment-link-client');
const paymentLinkValues = require('./payment/payment-link-values');
const { FraudClient } = require('./fraud/fraud-client');
const { WalletClient } = require('./wallet/wallet-client');
const walletValues = require('./wallet/wallet-values');
const fraudTaxonomy = require('./fraud/taxonomy');
const { FraudEvents, FRAUD_EVENT_TYPES, FraudDecisionValue, FRAUD_DECISION_VALUES } = require('./fraud/fraud-events');
const { ALLOWED_FIELDS: FRAUD_EVALUATE_FIELDS } = require('./fraud/evaluate-request');
const {
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  CreatePaymentLinkRequest,
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
  CreateIntentRequest,
  DirectPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  PaymentLinkItem,
  PaymentLinkCustomField,
  CreatePaymentLinkRequest,
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
  ...errors,
};
