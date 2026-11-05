import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type AuthUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { enforceLimits } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { pushSubscriptions } from '../db/schema';
import { DB, type Db, REDIS } from '../infra/infra.module';
import { PUSH_SENDER, type PushSender } from './push';

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
const subscribeSchema = z
  .object({
    endpoint: z.url({ protocol: /^https$/ }).max(1000),
    keys: z.object({ p256dh: base64url.max(200), auth: base64url.max(100) }).strict(),
  })
  .strict();
type Subscribe = z.infer<typeof subscribeSchema>;
const unsubscribeSchema = z.object({ endpoint: z.url().max(1000) }).strict();
type Unsubscribe = z.infer<typeof unsubscribeSchema>;

/** Each signed-in browser can ask for alerts (web push). */
@Controller('push')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  @Get('key')
  key() {
    return { publicKey: this.push.publicKey };
  }

  /** Saves this browser's subscription for the caller (moving it if another account had it). */
  @Post('subscriptions')
  @HttpCode(200)
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(subscribeSchema)) body: Subscribe,
  ) {
    await enforceLimits(this.redis, [
      { key: `push-sub:${user.id}`, max: 30, windowSeconds: 60 * 60 },
    ]);
    await this.db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: user.id,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          createdAt: sql`now()`,
        },
      });
    return { ok: true };
  }

  /** Stops alerts to this browser (e.g. on sign-out). Only the caller's own subscription. */
  @Delete('subscriptions')
  @HttpCode(200)
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(unsubscribeSchema)) body: Unsubscribe,
  ) {
    await this.db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, user.id)),
      );
    return { ok: true };
  }
}
