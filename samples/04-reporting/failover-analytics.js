'use strict';

const { sampleClient, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.failoverRecoveryAnalytics({ range: '30d' }));
})();
