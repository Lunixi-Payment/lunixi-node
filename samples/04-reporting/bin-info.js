'use strict';

const { sampleClient, env, print } = require('../_common/bootstrap');

(async () => {
  print(await sampleClient().payments.binInfo(env('LUNIXI_BIN', '54000000')));
})();
