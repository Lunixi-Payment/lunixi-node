import { DynamicModule, Global, Module } from '@nestjs/common';
import { LunixiClient, LunixiClientOptions } from '../../src';
import type { NativeCheckoutAdapter } from '../_common/native-checkout';

export const LUNIXI_CLIENT = Symbol('LUNIXI_CLIENT');
export const NATIVE_CHECKOUT = Symbol('NATIVE_CHECKOUT');

@Global()
@Module({})
export class LunixiModule {
  static forRoot(options: LunixiClientOptions, nativeCheckout: NativeCheckoutAdapter): DynamicModule {
    return {
      module: LunixiModule,
      providers: [
        { provide: NATIVE_CHECKOUT, useValue: nativeCheckout },
        {
          provide: LUNIXI_CLIENT,
          useValue: new LunixiClient(options),
        },
      ],
      exports: [LUNIXI_CLIENT, NATIVE_CHECKOUT],
    };
  }
}
