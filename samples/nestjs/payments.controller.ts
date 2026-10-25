import { Body, Controller, Ip, Param, Post } from '@nestjs/common';
import { MerchantPaymentsService } from './payments.service';

@Controller('merchant/payments')
export class MerchantPaymentsController {
  constructor(private readonly payments: MerchantPaymentsService) {}

  @Post('checkout-intents')
  createCheckoutIntent(@Body() body: { amount: number; orderId: string }, @Ip() ip: string) {
    return this.payments.createCheckoutIntent({
      amount: body.amount,
      orderId: body.orderId,
      buyerIp: ip,
    });
  }

  @Post('card-3d')
  card3d(@Body() body: { amount: number; orderId: string }, @Ip() ip: string) {
    return this.payments.payByCard3d({
      amount: body.amount,
      orderId: body.orderId,
      buyerIp: ip,
    });
  }

  @Post(':id/capture')
  capture(@Param('id') id: string) {
    return this.payments.capture(id);
  }
}
