import { Inject, Injectable, Logger } from '@nestjs/common';
import { redactPhone } from '@gadmo/shared';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { enforceLimits } from '../common/rate-limit';
import { REDIS } from '../infra/infra.module';
import { SMS_SENDER, type SmsSender } from './sms';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpVerifyResult = 'ok' | 'invalid' | 'locked';

/**
 * One-time login codes. Codes are 6 random digits, stored only as an HMAC,
 * expire after 5 minutes and are destroyed after 5 wrong guesses.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger('OTP');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async request(phone: string, ip: string): Promise<void> {
    await enforceLimits(this.redis, [
      { key: `otp:phone:${phone}`, max: 3, windowSeconds: 10 * 60 },
      { key: `otp:phone-day:${phone}`, max: 10, windowSeconds: 24 * 60 * 60 },
      { key: `otp:ip:${ip}`, max: this.env.OTP_IP_HOURLY_LIMIT, windowSeconds: 60 * 60 },
    ]);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .set(this.codeKey(phone), this.hash(phone, code), 'EX', OTP_TTL_SECONDS)
      .del(this.attemptsKey(phone))
      .exec();
    this.devLog(phone, 'new code stored; any earlier code for this number no longer works');

    await this.sms.send(
      phone,
      `Your GADMO code is ${code}. It expires in 5 minutes. GADMO staff will never ask for it.`,
    );
  }

  /**
   * 'ok' only for the current, unexpired, correct code; a code works once.
   * 'locked' once 5 wrong guesses have been made: the code is destroyed and only a
   * new code (which resets the count) can sign in.
   */
  async verify(phone: string, code: string): Promise<OtpVerifyResult> {
    if (this.isDevLoginCode(code)) {
      this.devLog(phone, 'accepted: DEV_LOGIN_CODE (development only)');
      return 'ok';
    }

    const attempts = await this.redis
      .multi()
      .incr(this.attemptsKey(phone))
      .expire(this.attemptsKey(phone), OTP_TTL_SECONDS)
      .exec();
    const attemptCount = Number(attempts?.[0]?.[1] ?? 0);
    if (attemptCount > OTP_MAX_ATTEMPTS) {
      await this.redis.del(this.codeKey(phone));
      this.devLog(phone, 'refused: too many wrong tries, ask for a new code');
      return 'locked';
    }

    const stored = await this.redis.get(this.codeKey(phone));
    if (!stored) {
      this.devLog(phone, 'refused: no active code (expired after 5 minutes, or already used)');
      return 'invalid';
    }

    const expected = Buffer.from(stored, 'hex');
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      if (attemptCount >= OTP_MAX_ATTEMPTS) {
        // Last guess used up: destroy the code but keep the counter, so later
        // guesses are told to ask for a new code.
        await this.redis.del(this.codeKey(phone));
        this.devLog(phone, 'refused: wrong code, that was the last try');
        return 'locked';
      }
      this.devLog(
        phone,
        `refused: the code typed does not match the newest code (try ${attemptCount} of ${OTP_MAX_ATTEMPTS})`,
      );
      return 'invalid';
    }

    // Single use: delete atomically so two parallel requests can't both succeed.
    const deleted = await this.redis.del(this.codeKey(phone));
    await this.redis.del(this.attemptsKey(phone));
    this.devLog(phone, deleted === 1 ? 'accepted: signed in' : 'refused: code was just used');
    return deleted === 1 ? 'ok' : 'invalid';
  }

  /** Development only (env.ts refuses DEV_LOGIN_CODE anywhere else). */
  private isDevLoginCode(code: string): boolean {
    const dev = this.env.DEV_LOGIN_CODE;
    if (this.env.NODE_ENV !== 'development' || !dev) return false;
    return dev.length === code.length && timingSafeEqual(Buffer.from(dev), Buffer.from(code));
  }

  /**
   * Development only: explains each sign-in attempt in the API window, so a refused
   * code can be diagnosed. Never logs the code or the full phone number.
   */
  private devLog(phone: string, message: string): void {
    if (this.env.NODE_ENV === 'development') this.logger.log(`${redactPhone(phone)}: ${message}`);
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.env.OTP_PEPPER).update(`${phone}:${code}`).digest('hex');
  }

  private codeKey(phone: string): string {
    return `otp:code:${phone}`;
  }

  private attemptsKey(phone: string): string {
    return `otp:attempts:${phone}`;
  }
}
