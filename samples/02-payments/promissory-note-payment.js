'use strict';

// Senetle Ödeme (promissory notes) from the merchant server:
//   1. payments.listPaymentMethods() gives the provider and the debtor fields it asks for
//      (debtorType, birthDate, address, guarantors …; name, e-mail and phone come from buyer);
//   2. reference.listProvinces() / listDistricts() / listNeighborhoods() give the address codes;
//   3. payments.directMethodPayment() issues the notes at once: the payment is CAPTURED, there is
//      no buyer action. The money is collected at each due date from the debtor to your account;
//   4. payments.getPromissoryNotes() lists the notes, downloadPromissoryNoteDocument() saves the PDF.
// Note results arrive by webhook: payment.promissory_note.paid | protested | cancelled.

const fs = require('node:fs');
const { DirectMethodPaymentRequest, PaymentMethod } = require('../../src');
const { sampleClient, env, idempotencyKey, sampleBuyer, print } = require('../_common/bootstrap');

function dueDate(monthsAhead) {
  const date = new Date();
  date.setUTCDate(15);
  date.setUTCMonth(date.getUTCMonth() + monthsAhead);
  return date.toISOString().slice(0, 10);
}

(async () => {
  const client = sampleClient();
  const amount = 300000;

  const methods = (await client.payments.listPaymentMethods()).data.methods;
  const method = methods.find((entry) => entry.paymentMethod === PaymentMethod.PROMISSORY_NOTE);
  if (!method) throw new Error('Senetle Ödeme is not open for this account (form settings and provider connection).');
  const provider = method.providers[0];
  console.log('Fields the provider asks for:', provider.inputFields.map((field) => `${field.key} (${field.type})`).join(', '));

  const provinceCode = env('LUNIXI_DEBTOR_PROVINCE_CODE', '06');
  const districts = (await client.reference.listDistricts(provinceCode)).data.items;
  if (districts.length === 0) console.log(`No district list for province ${provinceCode} yet; using LUNIXI_DEBTOR_DISTRICT_CODE.`);

  const fields = {
    debtorType: 'INDIVIDUAL',
    birthDate: env('LUNIXI_DEBTOR_BIRTH_DATE', '1990-01-01'),
    address: {
      provinceCode,
      districtCode: env('LUNIXI_DEBTOR_DISTRICT_CODE', districts[0] ? districts[0].code : '1'),
      neighborhoodCode: env('LUNIXI_DEBTOR_NEIGHBORHOOD_CODE', '1'),
      line: env('LUNIXI_DEBTOR_ADDRESS_LINE', 'Example Street 1'),
    },
  };

  const orderId = `ORD-PN-${Date.now()}`;
  const request = new DirectMethodPaymentRequest(amount, 'TRY', orderId)
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, method.providerSelection === 'REQUIRED' ? provider.providerCode : null, fields)
    .withPromissoryNoteSchedule([
      { amount: 100000, dueDate: dueDate(1) },
      { amount: 200000, dueDate: dueDate(2) },
    ])
    .withBuyer(sampleBuyer());

  const payment = await client.payments.directMethodPayment(request, idempotencyKey('promissory-note'));
  print(payment);

  const { paymentId } = payment.data;
  print(await client.payments.getPromissoryNotes(paymentId));

  const document = await client.payments.downloadPromissoryNoteDocument(paymentId, 'tr-TR');
  const file = `promissory-notes-${orderId}.pdf`;
  fs.writeFileSync(file, document.data);
  console.log(`Saved ${file} (${document.data.length} bytes).`);
})();
