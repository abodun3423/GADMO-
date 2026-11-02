import { Inject, Injectable } from '@nestjs/common';
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
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async request(phone: string, ip: string): Promise<void> {
    await enforceLimits(this.redis, [
      { key: `otp:phone:${phone}`, max: 3, windowSeconds: 10 * 60 },
      { key: `otp:phone-day:${phone}`, max: 10, windowSeconds: 24 * 60 * 60 },
      { key: `otp:ip:${ip}`, max: 30, windowSeconds: 60 * 60 },
    ]);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .set(this.codeKey(phone), this.hash(phone, code), 'EX', OTP_TTL_SECONDS)
      .del(this.attemptsKey(phone))
      .exec();

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
    const attempts = await this.redis
      .multi()
      .incr(this.attemptsKey(phone))
      .expire(this.attemptsKey(phone), OTP_TTL_SECONDS)
      .exec();
    const attemptCount = Number(attempts?.[0]?.[1] ?? 0);
    if (attemptCount > OTP_MAX_ATTEMPTS) {
      await this.redis.del(this.codeKey(phone));
      return 'locked';
    }

    const stored = await this.redis.get(this.codeKey(phone));
    if (!stored) return 'invalid';

    const expected = Buffer.from(stored, 'hex');
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      if (attemptCount >= OTP_MAX_ATTEMPTS) {
        // Last guess used up: destroy the code but keep the counter, so later
        // guesses are told to ask for a new code.
        await this.redis.del(this.codeKey(phone));
        return 'locked';
      }
      return 'invalid';
    }

    // Single use: delete atomically so two parallel requests can't both succeed.
    const deleted = await this.redis.del(this.codeKey(phone));
    await this.redis.del(this.attemptsKey(phone));
    return deleted === 1 ? 'ok' : 'invalid';
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
