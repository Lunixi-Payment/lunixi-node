'use strict';

const { InstallmentOptionsRequest } = require('../../src');
const { sampleClient, env, print } = require('../_common/bootstrap');

(async () => {
  const request = new InstallmentOptionsRequest(10050, 'TRY')
    .withBinOrPan(env('LUNIXI_BIN', '54000000'))
    .withInstallment(3);

  print(await sampleClient().payments.installmentOptions(request));
})();
