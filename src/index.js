'use strict';

const { Configuration } = require('./configuration');
const { ApiClient } = require('./api-client');
const { Ed25519Signer } = require('./auth/ed25519-signer');
const { TokenManager, InMemoryTokenStore } = require('./auth/token-manager');
const { WebhookVerifier } = require('./webhook/webhook-verifier');
const { PaymentClient } = require('./payment/payment-client');
const {
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
} = require('./payment/dto');
const errors = require('./errors');

class LunixiClient {
  constructor(options = {}) {
    this.config = new Configuration(options);
    this.signer = new Ed25519Signer(this.config.privateKey);
    this.tokens = new TokenManager(this.config, this.signer, options.tokenStore || new InMemoryTokenStore());
    this.api = new ApiClient(this.config, this.signer, this.tokens);
    this.payments = new PaymentClient(this.api);
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
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  CreateIntentRequest,
  DirectPaymentRequest,
  InstallmentOptionsRequest,
  StoreCardRequest,
  ...errors,
};
