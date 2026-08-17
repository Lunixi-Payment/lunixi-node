'use strict';

const { ConfigurationError } = require('./errors');

class Configuration {
  constructor(options = {}) {
    this.baseUrl = stripTrailingSlash(required(options.baseUrl, 'baseUrl'));
    this.keyId = required(options.keyId, 'keyId');
    this.privateKey = required(options.privateKey, 'privateKey');
    this.authTokenPath = options.authTokenPath || '/api/v1/auth/token';
    this.timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 30000;
    this.maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
    this.userAgent = options.userAgent || '@lunixi/node-sdk/0.1.0';
    this.fetch = options.fetch || globalThis.fetch;

    if (typeof this.fetch !== 'function') {
      throw new ConfigurationError('Node.js 18+ fetch is required, or pass a custom fetch implementation.');
    }
  }
}

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`Configuration field '${field}' is required.`);
  }
  return value.trim();
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

module.exports = { Configuration };
