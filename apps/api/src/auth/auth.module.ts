import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard, JwtAuthGuard } from './guards';
import { OtpService } from './otp.service';
import { StaffAuthController } from './staff-auth.controller';
import { ENV, type Env } from '../config/env';
import {
  ConsoleSmsSender,
  DisabledSmsSender,
  OutboxSmsSender,
  SMS_SENDER,
  TermiiSmsSender,
} from './sms';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, StaffAuthController],
  providers: [
    OtpService,
    TokenService,
    AuthService,
    JwtAuthGuard,
    ConsoleSmsSender,
    OutboxSmsSender,
    DisabledSmsSender,
    {
      provide: SMS_SENDER,
      inject: [ENV, ConsoleSmsSender, OutboxSmsSender, DisabledSmsSender],
      useFactory: (
        env: Env,
        consoleSms: ConsoleSmsSender,
        outbox: OutboxSmsSender,
        disabled: DisabledSmsSender,
      ) => {
        if (env.SMS_PROVIDER === 'outbox') return outbox;
        if (env.SMS_PROVIDER === 'console') return consoleSms;
        if (env.SMS_PROVIDER === 'disabled') return disabled;
        return new TermiiSmsSender(
          env.SMS_API_KEY!,
          env.SMS_SENDER_ID,
          env.SMS_BASE_URL,
          env.SMS_CHANNEL,
        );
      },
    },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [TokenService, JwtAuthGuard, SMS_SENDER, OtpService],
})
export class AuthModule {}
