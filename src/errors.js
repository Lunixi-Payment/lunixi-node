'use strict';

class LunixiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options.cause;
  }
}

class ConfigurationError extends LunixiError {}
class SignatureError extends LunixiError {}

class ApiError extends LunixiError {
  constructor(message, options = {}) {
    super(message, options);
    this.statusCode = options.statusCode || 0;
    this.code = options.code || null;
    this.response = options.response || null;
    this.requestId = options.requestId || null;
  }
}

module.exports = {
  LunixiError,
  ConfigurationError,
  SignatureError,
  ApiError,
};
