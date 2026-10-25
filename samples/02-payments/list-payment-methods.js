'use strict';

// The payment methods open for your account: for each method the block name, the
// providers you can choose and the fields each provider asks the buyer for.

const { sampleClient, print } = require('../_common/bootstrap');

(async () => {
  const response = await sampleClient().payments.listPaymentMethods();
  for (const method of response.data.methods) {
    console.log(`${method.paymentMethod} (${method.providerSelection}, picked by ${method.providerSelectionMode}) block=${method.blockName} preauth=${method.preauth}`);
    for (const provider of method.providers) {
      const fields = provider.inputFields.map((field) => `${field.key}:${field.type}${field.required ? '*' : ''}`);
      console.log(`  ${provider.providerCode} ${provider.displayName} [${fields.join(', ')}]`);
    }
  }
  print(response);
})();
