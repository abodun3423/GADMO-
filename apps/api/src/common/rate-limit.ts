import { HttpException, HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';

export interface Limit {
  key: string;
  max: number;
  windowSeconds: number;
}

/** Fixed-window counters in Redis. Throws 429 if any limit is exceeded. */
export async function enforceLimits(redis: Redis, limits: Limit[]): Promise<void> {
  for (const limit of limits) {
    const key = `rl:${limit.key}`;
    const results = await redis
      .multi()
      .incr(key)
      .expire(key, limit.windowSeconds, 'NX')
      .ttl(key)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? limit.windowSeconds);
    if (count > limit.max) {
      throw new HttpException(
        {
          message: 'Too many attempts. Please wait and try again.',
          retryAfterSeconds: Math.max(ttl, 1),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
