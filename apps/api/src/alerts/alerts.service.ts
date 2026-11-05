import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type Redis from 'ioredis';
import { SMS_SENDER, type SmsSender } from '../auth/sms';
import { ENV, type Env } from '../config/env';
import { pushSubscriptions, users } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PUSH_SENDER, type PushSender } from './push';

export interface Alert {
  title: string;
  body: string;
  /** Path in the web app to open, e.g. /jobs/<id>. */
  url: string;
  /** Alerts with the same tag replace each other on the device. */
  tag?: string;
}

export interface AlertOptions {
  /** Also send an SMS: only for time-critical moments (it costs money per message). */
  sms?: boolean;
  /** At most one alert per key per this many seconds (e.g. chat messages). */
  throttle?: { key: string; seconds: number };
}

/**
 * Tells people what happened while they weren't looking (PRD: web push and SMS
 * notifications, SMS backing up key alerts because iPhone push needs GADMO on the home
 * screen). Alerts never contain phone numbers or emails. Sending never blocks or fails the
 * action that caused it.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Alerts');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  /** Fire and forget: call after the change is committed. */
  send(userId: string, alert: Alert, options: AlertOptions = {}): void {
    void this.deliver(userId, alert, options).catch((err: unknown) =>
      this.logger.error(`Alert failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /** The same as send, but waits (for tests and scripts). */
  async deliver(userId: string, alert: Alert, options: AlertOptions = {}): Promise<void> {
    if (options.throttle) {
      const first = await this.redis.set(
        `alert:${options.throttle.key}`,
        '1',
        'EX',
        options.throttle.seconds,
        'NX',
      );
      if (!first) return;
    }
    const targets = await this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (this.push.publicKey && targets.length) {
      const payload = JSON.stringify(alert);
      const results = await Promise.all(targets.map((t) => this.push.send(t, payload)));
      const gone = targets.filter((_, i) => results[i] === 'gone').map((t) => t.id);
      if (gone.length) {
        await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
      }
    }
    if (options.sms) {
      const [user] = await this.db
        .select({ phone: users.phone })
        .from(users)
        .where(eq(users.id, userId));
      if (user) {
        const link = new URL(alert.url, this.env.WEB_ORIGIN).toString();
        await this.sms.send(user.phone, `GADMO: ${alert.body} ${link}`);
      }
    }
  }
}
