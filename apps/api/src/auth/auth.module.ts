import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard, JwtAuthGuard } from './guards';
import { OtpService } from './otp.service';
import { ConsoleSmsSender, SMS_SENDER } from './sms';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    OtpService,
    TokenService,
    AuthService,
    JwtAuthGuard,
    { provide: SMS_SENDER, useClass: ConsoleSmsSender },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [TokenService, JwtAuthGuard],
})
export class AuthModule {}
