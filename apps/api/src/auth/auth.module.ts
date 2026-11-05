import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard, JwtAuthGuard } from './guards';
import { OtpService } from './otp.service';
import { StaffAuthController } from './staff-auth.controller';
import { ENV, type Env } from '../config/env';
import { ConsoleSmsSender, OutboxSmsSender, SMS_SENDER } from './sms';
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
    {
      provide: SMS_SENDER,
      inject: [ENV, ConsoleSmsSender, OutboxSmsSender],
      useFactory: (env: Env, consoleSms: ConsoleSmsSender, outbox: OutboxSmsSender) => {
        if (env.SMS_PROVIDER === 'outbox') return outbox;
        if (env.SMS_PROVIDER === 'console') return consoleSms;
        // Real SMS (Termii) arrives with the SMS integration pull request.
        throw new Error(`SMS provider "${env.SMS_PROVIDER}" is not available yet`);
      },
    },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [TokenService, JwtAuthGuard, SMS_SENDER],
})
export class AuthModule {}
