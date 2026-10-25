'use strict';

/**
 * Downloads a policy PDF. The document is read from the provider on every
 * call and is available while the policy is in force; 503
 * `insurance.document.unavailable` is temporary — retry later.
 */

const fs = require('node:fs');
const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');
const { ApiError } = require('../../src');

(async () => {
  const policyId = requiredEnv('LUNIXI_INSURANCE_POLICY_ID');
  try {
    const document = await sampleClient().insurance.getPolicyDocument(policyId);
    const file = `${policyId}.pdf`;
    fs.writeFileSync(file, document.data);
    print({ file, contentType: document.contentType, bytes: document.data.length });
  } catch (error) {
    if (error instanceof ApiError) {
      print({ status: error.statusCode, code: error.code });
      return;
    }
    throw error;
  }
})();
