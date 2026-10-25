'use strict';

/**
 * Lunixi reference codes for the insurance type fields that take a code
 * (province, district, device and vehicle brands and models …). Districts need
 * the province code as `parentCode`.
 */

const { sampleClient, env, print } = require('../_common/bootstrap');
const { InsuranceReferenceKind } = require('../../src');

(async () => {
  const insurance = sampleClient().insurance;
  const province = env('LUNIXI_PROVINCE_CODE', '35');

  for await (const district of insurance.iterateReferenceValues(InsuranceReferenceKind.DISTRICT, { parentCode: province, limit: 100 })) {
    print({ code: district.code, label: district.label.tr ?? district.label.en ?? null });
  }
})();
