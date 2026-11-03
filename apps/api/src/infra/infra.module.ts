import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { FieldCrypto } from '../common/field-crypto';
import { ENV, type Env } from '../config/env';
import * as schema from '../db/schema';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');
export const FIELD_CRYPTO = Symbol('FIELD_CRYPTO');

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
class ConnectionCloser implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}

/** Database and Redis connections and field encryption, available everywhere. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => new Pool({ connectionString: env.DATABASE_URL, max: 10 }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
    {
      provide: FIELD_CRYPTO,
      inject: [ENV],
      useFactory: (env: Env) => new FieldCrypto(env.FIELD_ENCRYPTION_KEY),
    },
    ConnectionCloser,
  ],
  exports: [DB, PG_POOL, REDIS, FIELD_CRYPTO],
})
export class InfraModule {}
