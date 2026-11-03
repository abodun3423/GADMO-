import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { otpRequestSchema, otpVerifySchema, type OtpRequest, type OtpVerify } from '@gadmo/shared';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { users } from '../db/schema';
import { DB, type Db } from '../infra/infra.module';
import { AuthService } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { type AuthUser, CurrentUser, JwtAuthGuard } from './guards';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get secureCookies(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** Always answers the same way so the response does not reveal whether a number is registered. */
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequest,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.otp.request(body.phone, req.ip ?? 'unknown');
    return { message: 'If the number is valid, a code has been sent by SMS.' };
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerify,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.verifyAndLogin(body, req.headers['user-agent']);
    setAuthCookies(res, session.accessToken, session.refreshToken, this.secureCookies);
    return { user: session.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException();
    try {
      const session = await this.auth.refresh(raw, req.headers['user-agent']);
      setAuthCookies(
        res,
        session.accessToken,
        session.refreshToken,
        this.secureCookies,
        session.refreshExpiresAt,
      );
      return { ok: true };
    } catch (err) {
      clearAuthCookies(res, this.secureCookies);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (raw) await this.tokens.revokeByRaw(raw);
    clearAuthCookies(res, this.secureCookies);
  }

  /** The signed-in user's own account. This is the only endpoint that returns their phone number. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() current: AuthUser) {
    const [user] = await this.db
      .select({ id: users.id, phone: users.phone, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);
    return { user };
  }
}
