import { Controller, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MerchantPaymentsService } from './payments.service';

@Controller('merchant/orders')
export class MerchantPaymentsController {
  constructor(private readonly payments: MerchantPaymentsService) {}

  @Post(':orderId/checkout')
  async checkout(@Param('orderId') orderId: string, @Req() request: unknown, @Res() response: Response) {
    try {
      const page = await this.payments.renderCheckout(request, orderId);
      response.status(page.status).set(page.headers).send(page.body);
    } catch (error: unknown) {
      const candidate = error !== null && typeof error === 'object'
        ? (error as { statusCode?: number }).statusCode : undefined;
      const status = candidate !== undefined && [401, 403, 404, 409].includes(candidate) ? candidate : 409;
      response.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        .json({ code: 'checkout_unavailable' });
    }
  }
}
