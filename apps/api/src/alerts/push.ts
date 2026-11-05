import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { Env } from '../config/env';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  /** The key browsers subscribe with; null when push is switched off. */
  readonly publicKey: string | null;
  /** 'gone' means the browser unsubscribed: forget it. */
  send(target: PushTarget, payload: string): Promise<'ok' | 'gone' | 'failed'>;
}

/** Real web push (VAPID), through each browser's own push service. */
export class WebPushSender implements PushSender {
  private readonly logger = new Logger('WebPush');
  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  async send(target: PushTarget, payload: string): Promise<'ok' | 'gone' | 'failed'> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          vapidDetails: {
            subject: this.subject,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
          },
          TTL: 60 * 60,
          urgency: 'high',
          timeout: 10_000,
        },
      );
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      this.logger.warn(`Push failed (${status ?? 'network'})`);
      return 'failed';
    }
  }
}

/**
 * VAPID keys: from the environment, or in development a pair made once and kept in
 * apps/api/.vapid.dev.json (git-ignored), so browsers stay subscribed across restarts.
 */
export function vapidKeys(env: Env): { publicKey: string; privateKey: string } | null {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }
  if (env.NODE_ENV === 'test') return webpush.generateVAPIDKeys();
  if (env.NODE_ENV !== 'development') return null;
  const file = join(__dirname, '..', '..', '.vapid.dev.json');
  const keys = webpush.generateVAPIDKeys();
  try {
    // 'wx' creates the file only if it doesn't exist yet, in one step.
    writeFileSync(file, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
    return keys;
  } catch (err) {
    if ((err as { code?: string }).code !== 'EEXIST') throw err;
    return JSON.parse(readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string };
  }
}
