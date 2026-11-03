import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  redactPhone,
  type StaffLogin,
  staffLoginSchema,
  type StaffPassword,
  staffPasswordSchema,
  type StaffVerify,
  staffVerifySchema,
} from '@gadmo/shared';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { auditLogs, users } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { AuthService } from './auth.service';
import { setAuthCookies } from './cookies';
import { type AuthUser, CurrentUser, JwtAuthGuard, Roles } from './guards';
import { OtpService } from './otp.service';
import { DECOY_HASH, hashPassword, verifyPassword } from './password';

const STAFF = new Set(['ADMIN', 'SUPER_ADMIN']);
/** The password step must be followed by the phone code within 5 minutes. */
const CHALLENGE_SECONDS = 5 * 60;
const WRONG = 'Email or password is wrong.';

/**
 * Sign-in for GADMO staff, separate from customers and Pros: email + password, then a
 * code sent to the staff member's phone. Sessions end after 12 hours.
 */
@Controller('auth/staff')
export class StaffAuthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
  ) {}

  /** Step 1: the password. On success a code is sent to the staff member's phone. */
  @Post('login')
  @HttpCode(202)
  async login(
    @Body(new ZodValidationPipe(staffLoginSchema)) body: StaffLogin,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const ip = req.ip ?? 'unknown';
    await enforceLimits(this.redis, [
      { key: `staff-login:email:${body.email}`, max: 10, windowSeconds: 15 * 60 },
      { key: `staff-login:ip:${ip}`, max: 30, windowSeconds: 15 * 60 },
    ]);
    const [user] = await this.db
      .select({
        id: users.id,
        phone: users.phone,
        role: users.role,
        status: users.status,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    // Always run one hash check, so an unknown email takes as long as a wrong password.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DECOY_HASH);
    if (!user || !ok || !STAFF.has(user.role) || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(WRONG);
    }

    await this.redis.set(this.challengeKey(user.id), '1', 'EX', CHALLENGE_SECONDS);
    await this.otp.request(user.phone, ip);
    return { message: `We sent a code to your phone (${redactPhone(user.phone)}).` };
  }

  /** Step 2: the phone code. Only works within 5 minutes of a correct password. */
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodValidationPipe(staffVerifySchema)) body: StaffVerify,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const [user] = await this.db
      .select({ id: users.id, phone: users.phone, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (!user || !STAFF.has(user.role)) throw new UnauthorizedException('Sign in again.');
    // Consume the challenge first, so one password check allows one code attempt run.
    const challenged = await this.redis.get(this.challengeKey(user.id));
    if (!challenged) throw new UnauthorizedException('Sign in again.');

    const result = await this.otp.verify(user.phone, body.code);
    if (result === 'locked') {
      await this.redis.del(this.challengeKey(user.id));
      throw new HttpException('Too many wrong tries. Sign in again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (result !== 'ok') throw new UnauthorizedException('The code is wrong or has expired.');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active');
    await this.redis.del(this.challengeKey(user.id));

    const session = await this.auth.startSession(user, false, 'staff', req.headers['user-agent']);
    setAuthCookies(
      res,
      session.accessToken,
      session.refreshToken,
      this.env.NODE_ENV === 'production',
      session.refreshExpiresAt,
    );
    await this.db
      .insert(auditLogs)
      .values({ actorId: user.id, action: 'STAFF_SIGN_IN', target: `user:${user.id}` });
    return { user: session.user };
  }

  /** A signed-in staff member changes their password (e.g. the one given by admin:grant). */
  @Post('password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @Roles(['ADMIN', 'SUPER_ADMIN'])
  async changePassword(
    @CurrentUser() staff: AuthUser,
    @Body(new ZodValidationPipe(staffPasswordSchema)) body: StaffPassword,
  ): Promise<void> {
    await enforceLimits(this.redis, [
      { key: `staff-password:${staff.id}`, max: 10, windowSeconds: 60 * 60 },
    ]);
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, staff.id));
    if (!(await verifyPassword(body.currentPassword, user?.passwordHash ?? DECOY_HASH))) {
      throw new UnauthorizedException('Your current password is wrong.');
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword) })
      .where(eq(users.id, staff.id));
    await this.db
      .insert(auditLogs)
      .values({ actorId: staff.id, action: 'STAFF_PASSWORD_CHANGED', target: `user:${staff.id}` });
  }

  private challengeKey(userId: string): string {
    return `staff-challenge:${userId}`;
  }
}
