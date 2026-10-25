'use strict';

// KARMA-ODEME M22: 3D Secure display (form setting), the continuation page's
// result (`completion`) and its error codes. Values follow the gateway
// (UpdateFormSettingsDto.threeDsDisplay, error catalog) and the PHP SDK.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ThreeDsDisplay, SplitCompletionOutcome, SplitPayErrorCode } = require('../src');

const PHP_PAYMENT = path.join(__dirname, '..', '..', 'php', 'src', 'Payment');
const TYPINGS = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');

function phpConstants(file) {
  const source = fs.readFileSync(path.join(PHP_PAYMENT, file), 'utf8');
  return Object.fromEntries([...source.matchAll(/public const (\w+) = '([^']+)';/g)].map((match) => [match[1], match[2]]));
}

function typedConstants(name) {
  const block = TYPINGS.match(new RegExp(`export const ${name}: \\{([\\s\\S]*?)\\};`));
  assert.ok(block, `${name} is declared in index.d.ts`);
  return Object.fromEntries([...block[1].matchAll(/readonly (\w+): '([^']+)'/g)].map((match) => [match[1], match[2]]));
}

test('ThreeDsDisplay has exactly the two values the gateway accepts', () => {
  assert.deepEqual({ ...ThreeDsDisplay }, { INLINE: 'INLINE', REDIRECT: 'REDIRECT' });
  assert.ok(Object.isFrozen(ThreeDsDisplay));
});

test('SplitCompletionOutcome matches the callbackUrl status values', () => {
  assert.deepEqual({ ...SplitCompletionOutcome }, { SUCCESS: 'success', FAILURE: 'failure', PENDING: 'pending' });
  assert.ok(Object.isFrozen(SplitCompletionOutcome));
});

test('continuation page and 3D Secure restart error codes', () => {
  assert.equal(SplitPayErrorCode.RESUME_UNAVAILABLE, 'split_pay.resume.unavailable');
  assert.equal(SplitPayErrorCode.RESUME_ALREADY_OPENED, 'split_pay.resume.already_opened');
  assert.equal(SplitPayErrorCode.RESUME_PROOF_INVALID, 'split_pay.resume.proof_invalid');
  assert.equal(SplitPayErrorCode.RESUME_NOT_CONFIGURED, 'split_pay.resume.not_configured');
  assert.equal(SplitPayErrorCode.THREE_DS_RESTART_EXHAUSTED, 'split_pay.three_ds.restart_exhausted');
  assert.equal(SplitPayErrorCode.THREE_DS_RESTART_EXPIRED, 'split_pay.three_ds.restart_expired');
  const values = Object.values(SplitPayErrorCode);
  assert.equal(new Set(values).size, values.length, 'no duplicate codes');
});

test('index.d.ts declares the same values as the runtime', () => {
  assert.deepEqual(typedConstants('ThreeDsDisplay'), { ...ThreeDsDisplay });
  assert.deepEqual(typedConstants('SplitCompletionOutcome'), { ...SplitCompletionOutcome });
  assert.deepEqual(typedConstants('SplitPayErrorCode'), { ...SplitPayErrorCode });
});

test('index.d.ts types the form and continuation page fields of a split answer', () => {
  const result = TYPINGS.match(/export interface SplitPaymentResult \{([\s\S]*?)\n\}/);
  assert.ok(result, 'SplitPaymentResult is declared');
  assert.match(result[1], /threeDsDisplay\?: ThreeDsDisplayValue;/);
  assert.match(result[1], /\n  paymentId\?: string;/);
  assert.match(result[1], /completion\?: SplitPaymentCompletion \| null;/);
  const fields = TYPINGS.match(/export interface SplitMerchantCallbackFields \{([\s\S]*?)\n\}/);
  assert.ok(fields, 'SplitMerchantCallbackFields is declared');
  const keys = [...fields[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ['_signature', '_timestamp', 'code', 'message', 'orderId', 'paymentId', 'status', 'success']);
});

test('the PHP SDK has the same values', () => {
  assert.deepEqual(phpConstants('ThreeDsDisplay.php'), { ...ThreeDsDisplay });
  assert.deepEqual(phpConstants('SplitCompletionOutcome.php'), { ...SplitCompletionOutcome });
  assert.deepEqual(phpConstants('SplitPayErrorCode.php'), { ...SplitPayErrorCode });
});
