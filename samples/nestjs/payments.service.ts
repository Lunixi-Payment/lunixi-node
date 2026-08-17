import { Inject, Injectable } from '@nestjs/common';
import {
  Address,
  BasketItem,
  Buyer,
  CreateIntentRequest,
  DirectPaymentRequest,
  CardDetails,
  LunixiClient,
} from '../../src';
import { LUNIXI_CLIENT } from './lunixi.module';

@Injectable()
export class MerchantPaymentsService {
  constructor(@Inject(LUNIXI_CLIENT) private readonly lunixi: LunixiClient) {}

  createCheckoutIntent(input: { orderId: string; amount: number; buyerIp: string }) {
    const request = new CreateIntentRequest(input.amount, 'TRY', input.orderId)
      .withCallbackUrl('https://merchant.example/payments/callback')
      .withPaymentChannel('WEB')
      .withPaymentGroup('PRODUCT')
      .withBuyer(sampleBuyer(input.buyerIp))
      .withBillingAddress(sampleBillingAddress())
      .withBasketItems(sampleBasketItems(input.amount));

    return this.lunixi.payments.createIntent(request, `checkout:${input.orderId}`);
  }

  chargeDirect3d(input: { orderId: string; amount: number; buyerIp: string }) {
    const request = new DirectPaymentRequest(
      input.amount,
      'TRY',
      input.orderId,
      new CardDetails({
        cardHolderName: 'Ada Yilmaz',
        cardNumber: '5400000000000004',
        expireMonth: '12',
        expireYear: '28',
        cvcNumber: '123',
      }),
      sampleBuyer(input.buyerIp),
      sampleBillingAddress(),
      sampleBasketItems(input.amount),
    )
      .withCallbackUrl('https://merchant.example/payments/3ds/callback')
      .withPaymentChannel('WEB')
      .withPaymentGroup('PRODUCT');

    return this.lunixi.payments.chargeCard3d(request, `direct-3d:${input.orderId}`);
  }

  capture(paymentId: string) {
    return this.lunixi.payments.capture(paymentId, null, `capture:${paymentId}`);
  }
}

function sampleBuyer(ip: string) {
  return new Buyer({
    name: 'Ada',
    surname: 'Yilmaz',
    identityNumber: '11111111111',
    email: 'ada@example.com',
    gsmNumber: '+905350000000',
    city: 'Istanbul',
    country: 'Turkey',
    zipCode: '34000',
    ip,
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

function sampleBasketItems(amount: number) {
  return [
    new BasketItem({
      id: 'SKU-001',
      price: amount,
      name: 'Demo Product',
      category1: 'Demo',
      itemType: BasketItem.TYPE_PHYSICAL,
    }),
  ];
}
