import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { PAYMENT_GATEWAY, PaystackGateway, TestGateway } from './gateway';
import { PaymentsController, PaystackWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { QuotesController } from '../quotes/quotes.controller';
import { AdminWithdrawalsController, WalletController } from '../wallet/wallet.controller';
import { WalletService } from '../wallet/wallet.service';
import { WorkController } from '../work/work.controller';

@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.PAYMENT_PROVIDER === 'paystack'
          ? new PaystackGateway(env.PAYSTACK_SECRET_KEY!)
          : new TestGateway(env.WEB_ORIGIN),
    },
    PaymentsService,
    WalletService,
  ],
  controllers: [
    PaymentsController,
    PaystackWebhookController,
    QuotesController,
    WalletController,
    AdminWithdrawalsController,
    WorkController,
  ],
})
export class PaymentsModule {}
