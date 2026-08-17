'use strict';

const express = require('express');
const {
  LunixiClient,
  CreateIntentRequest,
  DirectPaymentRequest,
  CardDetails,
  Buyer,
  Address,
  BasketItem,
  WebhookVerifier,
} = require('../../src');

const app = express();
const lunixi = new LunixiClient({
  baseUrl: process.env.LUNIXI_BASE_URL || 'http://localhost:3000',
  keyId: process.env.LUNIXI_KEY_ID || 'kid_demo',
  privateKey: process.env.LUNIXI_PRIVATE_KEY || LunixiClient.generateKeyPair().privateKey,
});

app.use('/webhooks/lunixi', express.raw({ type: '*/*' }));
app.use(express.json());

app.post('/checkout/intents', async (req, res, next) => {
  try {
    const orderId = `ORD-NODE-${Date.now()}`;
    const intent = await lunixi.payments.createIntent(
      new CreateIntentRequest(10050, 'TRY', orderId)
        .withCallbackUrl('https://merchant.example/payment/callback')
        .withBuyer(sampleBuyer(req.ip))
        .withBillingAddress(sampleBillingAddress())
        .withBasketItems(sampleBasketItems()),
      `checkout:${orderId}`,
    );
    res.status(201).json(intent);
  } catch (error) {
    next(error);
  }
});

app.post('/payments/direct-3d', async (req, res, next) => {
  try {
    const orderId = `ORD-DIRECT-3D-${Date.now()}`;
    const result = await lunixi.payments.chargeCard3d(
      new DirectPaymentRequest(
        10050,
        'TRY',
        orderId,
        new CardDetails({
          cardHolderName: 'Ada Yilmaz',
          cardNumber: '5400000000000004',
          expireMonth: '12',
          expireYear: '28',
          cvcNumber: '123',
        }),
        sampleBuyer(req.ip),
        sampleBillingAddress(),
        sampleBasketItems(),
      ),
      `direct-3d:${orderId}`,
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/payments/:id/capture', async (req, res, next) => {
  try {
    const result = await lunixi.payments.capture(req.params.id, req.body.amount ?? null, `capture:${req.params.id}`);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/webhooks/lunixi', (req, res, next) => {
  try {
    const event = new WebhookVerifier(process.env.LUNIXI_WEBHOOK_SECRET || 'whsec_demo').verify(req.body, req.headers);
    res.json({ received: true, type: event.type || event.eventType || null });
  } catch (error) {
    next(error);
  }
});

function sampleBuyer(ip) {
  return new Buyer({
    name: 'Ada',
    surname: 'Yilmaz',
    identityNumber: '11111111111',
    email: 'ada@example.com',
    gsmNumber: '+905350000000',
    city: 'Istanbul',
    country: 'Turkey',
    zipCode: '34000',
    ip: ip || '127.0.0.1',
  });
}

function sampleBillingAddress() {
  return new Address({
    address: 'Example Street 1',
    zipCode: '34000',
    contactName: 'Ada Yilmaz',
    city: 'Istanbul',
    country: 'Turkey',
  });
}

function sampleBasketItems() {
  return [
    new BasketItem({
      id: 'SKU-001',
      price: 10050,
      name: 'Demo Product',
      category1: 'Demo',
      itemType: BasketItem.TYPE_PHYSICAL,
    }),
  ];
}

app.use((error, req, res, next) => {
  void next;
  res.status(error.statusCode || 500).json({
    code: error.code || 'internal_error',
    message: error.message,
  });
});

if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => {
    console.log(`Express sample listening on http://localhost:${process.env.PORT || 3000}`);
  });
}

module.exports = app;
