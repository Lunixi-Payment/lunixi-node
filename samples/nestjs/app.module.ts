import { Module } from '@nestjs/common';
import { LunixiModule } from './lunixi.module';
import { MerchantPaymentsController } from './payments.controller';
import { MerchantPaymentsService } from './payments.service';

@Module({
  imports: [
    LunixiModule.forRoot({
      baseUrl: process.env.LUNIXI_BASE_URL || 'https://api-gateway.lunixi.com',
      keyId: process.env.LUNIXI_KEY_ID || '',
      privateKey: (process.env.LUNIXI_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  ],
  controllers: [MerchantPaymentsController],
  providers: [MerchantPaymentsService],
})
export class AppModule {}
