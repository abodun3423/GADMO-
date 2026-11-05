import { Inject, Injectable, Logger } from '@nestjs/common';
import { redactPhone } from '@gadmo/shared';
import type Redis from 'ioredis';
import { REDIS } from '../infra/infra.module';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(toE164: string, text: string): Promise<void>;
}

/**
 * Development only: prints the message instead of sending it.
 * Startup refuses this provider when NODE_ENV=production (see config/env.ts).
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('DevSMS');

  async send(toE164: string, text: string): Promise<void> {
    this.logger.warn(`to ${redactPhone(toE164)}: ${text}`);
  }
}

/** Redis key where the outbox provider keeps the last login code message per phone (5 minutes). */
export const outboxKey = (toE164: string) => `test:sms-outbox:${toE164}`;
/** Redis list of alert messages (no login code) per phone, newest first, for browser tests. */
export const alertOutboxKey = (toE164: string) => `test:sms-alerts:${toE164}`;

/**
 * Automated browser tests only: keeps the last message for each phone in Redis so a
 * test can read the login code. Nothing is exposed over HTTP. Startup refuses this
 * provider when NODE_ENV=production (see config/env.ts).
 */
@Injectable()
export class OutboxSmsSender implements SmsSender {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async send(toE164: string, text: string): Promise<void> {
    // Alerts are kept apart so they never hide a login code a test is waiting for.
    if (/\b\d{6}\b/.test(text)) {
      await this.redis.set(outboxKey(toE164), text, 'EX', 300);
    } else {
      await this.redis
        .multi()
        .lpush(alertOutboxKey(toE164), text)
        .expire(alertOutboxKey(toE164), 300)
        .exec();
    }
  }
}
