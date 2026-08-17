import { DynamicModule, Global, Module } from '@nestjs/common';
import { LunixiClient, LunixiClientOptions } from '../../src';

export const LUNIXI_CLIENT = Symbol('LUNIXI_CLIENT');

@Global()
@Module({})
export class LunixiModule {
  static forRoot(options: LunixiClientOptions): DynamicModule {
    return {
      module: LunixiModule,
      providers: [
        {
          provide: LUNIXI_CLIENT,
          useValue: new LunixiClient(options),
        },
      ],
      exports: [LUNIXI_CLIENT],
    };
  }
}
