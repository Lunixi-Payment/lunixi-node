'use strict';

const { sampleClient, requiredEnv, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.providerCredentialAnalytics(
    requiredEnv('LUNIXI_PROVIDER_CREDENTIAL_ID'),
    { range: '30d' },
  ));
})();
