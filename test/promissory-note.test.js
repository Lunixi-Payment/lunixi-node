'use strict';

// Senetle Ödeme (paymentMethod PROMISSORY_NOTE): the `promissoryNote` block of
// POST /payments/direct/payment, `promissoryNote.schedule` of the intent, the three
// promissory-notes endpoints and the public address reference. Bodies follow the
// gateway's DirectMethodPaymentDto / CreatePaymentIntentDto / CancelPromissoryNotesDto
// (nest-payment-gateway apps/api-gateway/src/payments/dtos/). All values are synthetic.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LunixiClient,
  CreateIntentRequest,
  DirectMethodPaymentRequest,
  PaymentMethod,
  MethodInputFieldType,
  DIRECT_METHOD_PAYMENT_FIELDS,
  PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS,
  PromissoryNoteStatus,
  PromissoryNoteCancelResult,
  PromissoryNoteCancelErrorCode,
  PromissoryNoteDocumentLocale,
  PromissoryNoteEvents,
  ConfigurationError,
  ApiError,
  ServiceUnavailableError,
} = require('../src');

const PAYMENT_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const SCHEDULE = [
  { amount: 100000, dueDate: '2030-01-15' },
  { amount: 200000, dueDate: '2030-02-15' },
];

// Provider-declared debtor fields (from `inputFields` of GET /payments/methods); test values only.
const DEBTOR = {
  debtorType: 'INDIVIDUAL',
  name: 'Deneme',
  surname: 'Borclu',
  birthDate: '1990-01-01',
  email: 'borclu@example.com',
  gsmNumber: '+905000000000',
  address: { provinceCode: '06', districtCode: '1001', neighborhoodCode: '2001', line: 'Ornek Sokak No 1' },
  guarantors: [{ name: 'Deneme', surname: 'Kefil', birthDate: '1985-05-05', gsmNumber: '+905000000001' }],
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(body),
  };
}

function pdfResponse(bytes) {
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/pdf']]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString('latin1'),
  };
}

function makeClient(answer = () => jsonResponse(200, { status: 'success', code: 'SUCCESS', data: {} })) {
  const keys = LunixiClient.generateKeyPair();
  const calls = [];
  const fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/v1/auth/token')) {
      return jsonResponse(200, { access_token: 'bearer_x', expires_in: 3600 });
    }
    calls.push({ url: String(url), ...options });
    return answer(String(url), options);
  };
  const client = new LunixiClient({
    baseUrl: 'https://gw.example.com',
    keyId: 'kid_1',
    privateKey: keys.privateKey,
    fetch,
    maxRetries: 0,
  });
  return { client, calls };
}

function promissoryRequest() {
  return new DirectMethodPaymentRequest(300000, 'TRY', 'ORD-PN-1')
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, DEBTOR)
    .withPromissoryNoteSchedule(SCHEDULE);
}

function notesBody(extra = {}) {
  return {
    paymentId: PAYMENT_ID,
    providerCode: 'TEST_PROVIDER',
    documentType: 'PROMISSORY_NOTE',
    rowSerialNumber: 'ROW-0001',
    currency: 'TRY',
    totalAmount: 300000,
    notes: [
      { serialNumber: 'NOTE-0001', sequence: 1, amount: 100000, dueDate: '2030-01-15', status: 'ISSUED', paidAt: null, protestedAt: null, cancelledAt: null },
      { serialNumber: 'NOTE-0002', sequence: 2, amount: 200000, dueDate: '2030-02-15', status: 'ISSUED', paidAt: null, protestedAt: null, cancelledAt: null },
    ],
    ...extra,
  };
}

// --- Value sets ----------------------------------------------------------------------

test('value sets match the gateway contract', () => {
  assert.equal(PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS, 24);
  assert.deepEqual(Object.values(PromissoryNoteStatus), ['ISSUED', 'PAID', 'PROTESTED', 'CANCELLED']);
  assert.deepEqual(Object.values(PromissoryNoteCancelResult), ['CANCELLED', 'ALREADY_CLOSED', 'NOT_CANCELLABLE', 'FAILED']);
  assert.deepEqual(Object.values(PromissoryNoteCancelErrorCode), [
    'payment.promissory_note.not_cancellable',
    'payment.promissory_note.provider_unavailable',
    'payment.promissory_note.cancel_rejected',
  ]);
  assert.deepEqual(Object.values(PromissoryNoteDocumentLocale), ['tr-TR', 'en-GB']);
  assert.deepEqual(Object.values(PromissoryNoteEvents), [
    'payment.promissory_note.paid',
    'payment.promissory_note.protested',
    'payment.promissory_note.cancelled',
  ]);
  for (const type of ['VKN', 'ADDRESS', 'GROUP']) assert.equal(MethodInputFieldType[type], type);
  assert.ok(DIRECT_METHOD_PAYMENT_FIELDS.includes('promissoryNote'));
});

// --- DirectMethodPaymentRequest ------------------------------------------------------

test('a schedule goes into the promissoryNote block next to the provider fields', () => {
  const body = promissoryRequest().toJSON();

  assert.deepEqual(body, {
    paymentMethod: 'PROMISSORY_NOTE',
    amount: 300000,
    currency: 'TRY',
    orderId: 'ORD-PN-1',
    promissoryNote: { ...DEBTOR, schedule: SCHEDULE },
  });
  for (const key of Object.keys(body)) assert.ok(DIRECT_METHOD_PAYMENT_FIELDS.includes(key), key);
});

test('a note count is sent as a string; providerCode stays first in the block', () => {
  const body = new DirectMethodPaymentRequest(300000, 'TRY', 'ORD-PN-2')
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, 'TEST_PROVIDER', { debtorType: 'INDIVIDUAL' })
    .withPromissoryNoteCount(3)
    .toJSON();

  assert.deepEqual(body.promissoryNote, { providerCode: 'TEST_PROVIDER', debtorType: 'INDIVIDUAL', noteCount: '3' });
  assert.equal(Object.keys(body.promissoryNote)[0], 'providerCode');
});

test('noteCount from inputFields may also be passed in the fields', () => {
  const body = new DirectMethodPaymentRequest(300000, 'TRY', 'ORD-PN-3')
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, { noteCount: '2' })
    .toJSON();
  assert.equal(body.promissoryNote.noteCount, '2');
});

test('the plan is required, given once and only with PROMISSORY_NOTE', () => {
  const base = () => new DirectMethodPaymentRequest(300000, 'TRY', 'ORD-PN-4');

  assert.throws(() => base().withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, DEBTOR).toJSON(), /schedule .* or a noteCount/);
  assert.throws(
    () => base().withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, { noteCount: '3' }).withPromissoryNoteSchedule(SCHEDULE).toJSON(),
    /given twice/,
  );
  assert.throws(
    () => base().withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, { schedule: SCHEDULE }),
    /withPromissoryNoteSchedule/,
  );
  assert.throws(
    () => base().withMethodFields(PaymentMethod.MOBILE_BILLING, null, {}).withPromissoryNoteCount(2).toJSON(),
    /only be sent with paymentMethod PROMISSORY_NOTE/,
  );
  // The later call replaces the earlier plan.
  const replaced = base().withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, {})
    .withPromissoryNoteCount(2).withPromissoryNoteSchedule(SCHEDULE).toJSON();
  assert.deepEqual(replaced.promissoryNote, { schedule: SCHEDULE });
});

test('schedule rows are checked before sending', () => {
  const request = () => new DirectMethodPaymentRequest(300000, 'TRY', 'ORD-PN-5')
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, {});
  const bad = [
    [],
    'monthly',
    [{ amount: 300000 }],
    [{ amount: 300000, dueDate: '15.01.2030' }],
    [{ amount: 300000, dueDate: '2030-02-30' }],
    [{ amount: 300000.5, dueDate: '2030-01-15' }],
    [{ amount: '300000', dueDate: '2030-01-15' }],
    [{ amount: 0, dueDate: '2030-01-15' }],
    [{ amount: 300000, dueDate: '2030-01-15', currency: 'TRY' }],
    [{ amount: 100000, dueDate: '2030-02-15' }, { amount: 200000, dueDate: '2030-01-15' }],
    Array.from({ length: 25 }, () => ({ amount: 12000, dueDate: '2030-01-15' })),
  ];
  for (const schedule of bad) {
    assert.throws(() => request().withPromissoryNoteSchedule(schedule), ConfigurationError, JSON.stringify(schedule).slice(0, 80));
  }
  // Same due date twice is allowed; 24 rows is the limit.
  assert.doesNotThrow(() => request()
    .withPromissoryNoteSchedule([{ amount: 150000, dueDate: '2030-01-15' }, { amount: 150000, dueDate: '2030-01-15' }])
    .toJSON());
  assert.doesNotThrow(() => new DirectMethodPaymentRequest(24 * 12500, 'TRY', 'O')
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, {})
    .withPromissoryNoteSchedule(Array.from({ length: 24 }, () => ({ amount: 12500, dueDate: '2030-01-15' })))
    .toJSON());
});

test('the schedule must add up to amount', () => {
  const request = new DirectMethodPaymentRequest(300001, 'TRY', 'ORD-PN-6')
    .withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, {})
    .withPromissoryNoteSchedule(SCHEDULE);
  assert.throws(() => request.toJSON(), /adds up to 300000; it must equal amount \(300001\)/);
});

test('note counts outside 1–24 are refused', () => {
  const request = () => new DirectMethodPaymentRequest(300000, 'TRY', 'O');
  for (const count of [0, 25, -1, 2.5, '03', 'three', '', null]) {
    assert.throws(() => request().withPromissoryNoteCount(count), ConfigurationError, JSON.stringify(count));
  }
  assert.throws(() => request().withMethodFields(PaymentMethod.PROMISSORY_NOTE, null, { noteCount: '30' }), ConfigurationError);
  assert.doesNotThrow(() => request().withPromissoryNoteCount('24'));
});

// --- payments.directMethodPayment ----------------------------------------------------

test('directMethodPayment sends the promissory-note body signed and keyed; the answer is CAPTURED without an action', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, {
    status: 'success',
    code: 'SUCCESS',
    data: { paymentId: PAYMENT_ID, orderId: 'ORD-PN-1', status: 'CAPTURED', paymentMethod: 'PROMISSORY_NOTE', providerCode: 'TEST_PROVIDER' },
  }));

  const response = await client.payments.directMethodPayment(promissoryRequest(), 'pay:ORD-PN-1');

  const call = calls.at(-1);
  assert.equal(call.url, 'https://gw.example.com/api/v1/payments/direct/payment');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Idempotency-Key'], 'pay:ORD-PN-1');
  assert.ok(call.headers['X-Signature']);
  assert.ok(call.headers.Digest);
  assert.deepEqual(JSON.parse(call.body), promissoryRequest().toJSON());
  assert.equal(response.data.status, 'CAPTURED');
  assert.equal(response.data.action, undefined);
});

test('a raw promissory-note body is checked for its plan before sending', async () => {
  const { client, calls } = makeClient();
  const raw = (promissoryNote) => ({ paymentMethod: 'PROMISSORY_NOTE', amount: 300000, currency: 'TRY', orderId: 'O', promissoryNote });

  await assert.rejects(() => client.payments.directMethodPayment(raw({ ...DEBTOR }), 'k-1'), /schedule .* or a noteCount/);
  await assert.rejects(() => client.payments.directMethodPayment(raw({ schedule: SCHEDULE, noteCount: '2' }), 'k-2'), /either schedule or noteCount/);
  await assert.rejects(() => client.payments.directMethodPayment(raw({ schedule: [{ amount: 1, dueDate: '2030-01-15' }] }), 'k-3'), /must equal amount/);
  await assert.rejects(() => client.payments.directMethodPayment(raw(undefined), 'k-4'), /requires the 'promissoryNote' block/);
  assert.equal(calls.length, 0);

  await client.payments.directMethodPayment(raw({ noteCount: '3' }), 'k-5');
  assert.equal(calls.length, 1);
});

test('a block error from the gateway is a ValidationError with the field path', async () => {
  const { client } = makeClient(() => jsonResponse(400, {
    status: 'failure',
    code: 'payment.method.block_invalid',
    message: 'Invalid',
    details: { field: 'promissoryNote.schedule[1].dueDate', errors: [{ field: 'promissoryNote.schedule[1].dueDate', reason: 'not_in_future' }] },
  }));
  await assert.rejects(() => client.payments.directMethodPayment(promissoryRequest(), 'k-6'), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'payment.method.block_invalid');
    assert.equal(error.response.details.errors[0].reason, 'not_in_future');
    return true;
  });
});

// --- Intent --------------------------------------------------------------------------

test('an intent carries promissoryNote.schedule only', () => {
  const body = new CreateIntentRequest(300000, 'TRY', 'ORD-PN-I1')
    .withPaymentMethod(PaymentMethod.PROMISSORY_NOTE)
    .withPromissoryNoteSchedule(SCHEDULE)
    .toJSON();
  assert.deepEqual(body.promissoryNote, { schedule: SCHEDULE });
  assert.equal(body.paymentMethod, 'PROMISSORY_NOTE');

  // Without a pinned method the buyer may still choose another method; the schedule is kept for this one.
  assert.doesNotThrow(() => new CreateIntentRequest(300000, 'TRY', 'O').withPromissoryNoteSchedule(SCHEDULE).toJSON());
  assert.throws(
    () => new CreateIntentRequest(300000, 'TRY', 'O').withPaymentMethod('CARD').withPromissoryNoteSchedule(SCHEDULE).toJSON(),
    /cannot be sent with paymentMethod CARD/,
  );
  assert.throws(() => new CreateIntentRequest(300001, 'TRY', 'O').withPromissoryNoteSchedule(SCHEDULE).toJSON(), /must equal amount/);
});

test('createIntent checks a raw promissoryNote before sending', async () => {
  const { client, calls } = makeClient();
  const raw = (promissoryNote) => ({ amount: 300000, currency: 'TRY', orderId: 'O', paymentMethod: 'PROMISSORY_NOTE', promissoryNote });

  await assert.rejects(() => client.payments.createIntent(raw({ noteCount: '3' })), /carries only schedule/);
  await assert.rejects(() => client.payments.createIntent(raw({ schedule: [] })), ConfigurationError);
  assert.equal(calls.length, 0);

  await client.payments.createIntent(raw({ schedule: SCHEDULE }), 'intent-pn-0001');
  assert.equal(calls[0].url, 'https://gw.example.com/api/v1/payments/intents');
  assert.deepEqual(JSON.parse(calls[0].body).promissoryNote, { schedule: SCHEDULE });
});

// --- Promissory-notes endpoints ------------------------------------------------------

test('getPromissoryNotes is a GET of the payment notes', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, { status: 'success', code: 'SUCCESS', data: notesBody() }));

  const response = await client.payments.getPromissoryNotes(PAYMENT_ID);

  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, `https://gw.example.com/api/v1/payments/${PAYMENT_ID}/promissory-notes`);
  assert.equal(calls[0].body, null);
  // The API surface accepts only a signed key request (Bearer + Ed25519).
  assert.ok(calls[0].headers['X-Signature']);
  assert.equal(response.data.notes.length, 2);
  assert.equal(response.data.notes[0].status, PromissoryNoteStatus.ISSUED);
  await assert.rejects(() => client.payments.getPromissoryNotes(''), ConfigurationError);
  await assert.rejects(() => client.payments.getPromissoryNotes(null), ConfigurationError);
});

test('a payment without notes is a 404 ApiError', async () => {
  const { client } = makeClient(() => jsonResponse(404, { status: 'failure', code: 'payment.promissory_note.not_found', message: 'Not found' }));
  await assert.rejects(() => client.payments.getPromissoryNotes(PAYMENT_ID), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, 'payment.promissory_note.not_found');
    return true;
  });
});

test('cancelPromissoryNotes posts signed; without serial numbers it sends no body', async () => {
  const cancelled = notesBody({
    cancelResults: [
      { serialNumber: 'NOTE-0001', result: 'CANCELLED', errorCode: null },
      { serialNumber: 'NOTE-0002', result: 'NOT_CANCELLABLE', errorCode: 'payment.promissory_note.not_cancellable' },
    ],
  });
  const { client, calls } = makeClient(() => jsonResponse(200, { status: 'success', code: 'SUCCESS', data: cancelled }));

  const all = await client.payments.cancelPromissoryNotes(PAYMENT_ID);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `https://gw.example.com/api/v1/payments/${PAYMENT_ID}/promissory-notes/cancel`);
  assert.equal(calls[0].body, null);
  assert.ok(calls[0].headers['X-Signature']);
  assert.equal(calls[0].headers.Digest, undefined);
  assert.equal(all.data.cancelResults[1].result, PromissoryNoteCancelResult.NOT_CANCELLABLE);
  assert.equal(all.data.cancelResults[1].errorCode, PromissoryNoteCancelErrorCode.NOT_CANCELLABLE);
  assert.equal(all.data.cancelResults[0].errorCode, null);

  await client.payments.cancelPromissoryNotes(PAYMENT_ID, ['NOTE-0001'], 'cancel-pn-000001');
  assert.deepEqual(JSON.parse(calls[1].body), { serialNumbers: ['NOTE-0001'] });
  assert.ok(calls[1].headers.Digest);
  assert.equal(calls[1].headers['Idempotency-Key'], 'cancel-pn-000001');
});

test('cancel serial numbers are checked before sending', async () => {
  const { client, calls } = makeClient();
  for (const serialNumbers of [[], 'NOTE-0001', ['NO'], ['NOTE 0001'], [7], Array.from({ length: 25 }, (_, i) => `NOTE-${1000 + i}`)]) {
    await assert.rejects(() => client.payments.cancelPromissoryNotes(PAYMENT_ID, serialNumbers), ConfigurationError, JSON.stringify(serialNumbers).slice(0, 60));
  }
  assert.equal(calls.length, 0);
});

test('downloadPromissoryNoteDocument returns the PDF bytes', async () => {
  const pdf = Buffer.from('%PDF-1.7\n%test\n', 'latin1');
  const { client, calls } = makeClient(() => pdfResponse(pdf));

  const document = await client.payments.downloadPromissoryNoteDocument(PAYMENT_ID, PromissoryNoteDocumentLocale.EN);

  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, `https://gw.example.com/api/v1/payments/${PAYMENT_ID}/promissory-notes/document?locale=en-GB`);
  assert.match(calls[0].headers.Accept, /application\/pdf/);
  assert.ok(calls[0].headers['X-Signature']);
  assert.equal(document.contentType, 'application/pdf');
  assert.ok(Buffer.isBuffer(document.data));
  assert.deepEqual([...document.data], [...pdf]);

  await client.payments.downloadPromissoryNoteDocument(PAYMENT_ID);
  assert.equal(calls[1].url, `https://gw.example.com/api/v1/payments/${PAYMENT_ID}/promissory-notes/document`);
  await assert.rejects(() => client.payments.downloadPromissoryNoteDocument(PAYMENT_ID, 'tr'), /locale must be one of tr-TR, en-GB/);
});

test('an unavailable document is a ServiceUnavailableError read from JSON', async () => {
  const { client } = makeClient(() => jsonResponse(503, { status: 'failure', code: 'payment.promissory_note.document_unavailable', message: 'Try later' }));
  await assert.rejects(() => client.payments.downloadPromissoryNoteDocument(PAYMENT_ID), (error) => {
    assert.ok(error instanceof ServiceUnavailableError);
    assert.equal(error.code, 'payment.promissory_note.document_unavailable');
    return true;
  });
});

// --- Address reference ---------------------------------------------------------------

test('the address reference reads provinces, districts and neighborhoods', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, { status: 'success', code: 'SUCCESS', data: { items: [] } }));

  await client.reference.listProvinces();
  await client.reference.listDistricts('06');
  const neighborhoods = await client.reference.listNeighborhoods('1001');

  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace('https://gw.example.com', '')}`), [
    'GET /api/v1/reference/tr-address/provinces',
    'GET /api/v1/reference/tr-address/districts?provinceCode=06',
    'GET /api/v1/reference/tr-address/neighborhoods?districtCode=1001',
  ]);
  assert.deepEqual(neighborhoods.data.items, [], 'an empty level is returned as it is');
});

test('address codes are checked before sending', async () => {
  const { client, calls } = makeClient();
  for (const code of ['6', '00', '82', 6, '', null]) {
    await assert.rejects(() => client.reference.listDistricts(code), ConfigurationError, JSON.stringify(code));
  }
  for (const code of ['', 'abc', '1'.repeat(13), 1001, null]) {
    await assert.rejects(() => client.reference.listNeighborhoods(code), ConfigurationError, JSON.stringify(code));
  }
  assert.equal(calls.length, 0);
});
