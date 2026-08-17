'use strict';

const { sampleClient, print } = require('../_common/bootstrap');

(async () => {
  const client = sampleClient();
  print({ accessToken: await client.tokens.getToken() });
})();
