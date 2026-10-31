import { Inject, Injectable } from '@nestjs/common';
import { LunixiClient } from '../../src';
import { createNativeCheckout, NativeCheckoutAdapter } from '../_common/native-checkout';
import { LUNIXI_CLIENT, NATIVE_CHECKOUT } from './lunixi.module';

@Injectable()
export class MerchantPaymentsService {
  private readonly checkout: ReturnType<typeof createNativeCheckout>;
  constructor(
    @Inject(LUNIXI_CLIENT) lunixi: LunixiClient,
    @Inject(NATIVE_CHECKOUT) nativeCheckout: NativeCheckoutAdapter,
  ) { this.checkout = createNativeCheckout(lunixi, nativeCheckout); }

  renderCheckout(request: unknown, orderId: string) { return this.checkout(request, orderId); }
}
