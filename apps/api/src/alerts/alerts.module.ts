import { Global, Logger, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { PUSH_SENDER, type PushSender, vapidKeys, WebPushSender } from './push';

@Global()
@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: PUSH_SENDER,
      inject: [ENV],
      useFactory: (env: Env): PushSender => {
        const keys = vapidKeys(env);
        if (!keys) {
          new Logger('WebPush').warn('No VAPID keys: web push alerts are off.');
          return { publicKey: null, send: async () => 'failed' };
        }
        return new WebPushSender(keys.publicKey, keys.privateKey, env.VAPID_SUBJECT);
      },
    },
    AlertsService,
  ],
  controllers: [AlertsController],
  exports: [AlertsService],
})
export class AlertsModule {}
