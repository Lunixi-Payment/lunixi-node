import { Module, Type } from '@nestjs/common';
import type { LunixiClientOptions } from '../../src';
import type { NativeCheckoutAdapter } from '../_common/native-checkout';
import { LunixiModule } from './lunixi.module';
import { MerchantPaymentsController } from './payments.controller';
import { MerchantPaymentsService } from './payments.service';

/** Merchant bootstrap supplies its real native adapter; no fake auth/storage fallback. */
export function createAppModule(options: LunixiClientOptions, nativeCheckout: NativeCheckoutAdapter): Type<unknown> {
  @Module({
    imports: [LunixiModule.forRoot(options, nativeCheckout)],
    controllers: [MerchantPaymentsController],
    providers: [MerchantPaymentsService],
  })
  class AppModule {}
  return AppModule;
}
