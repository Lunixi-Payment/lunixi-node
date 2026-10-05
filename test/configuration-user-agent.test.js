'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Configuration, LunixiClient } = require('../src');
const pkg = require('../package.json');

test('the default User-Agent names the released package version', () => {
  const { privateKey } = LunixiClient.generateKeyPair();
  const config = new Configuration({ baseUrl: 'https://gw.example.com', keyId: 'kid', privateKey });
  assert.equal(config.userAgent, `@lunixi/node-sdk/${pkg.version}`);
});
