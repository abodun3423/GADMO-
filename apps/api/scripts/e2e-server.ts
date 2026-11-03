/**
 * Starts the API for browser (end-to-end) tests: recreates a throwaway *_e2e database,
 * migrates and seeds it, then serves on port 4100 with the "outbox" SMS provider so tests
 * can read login codes from Redis. Never used in production (the API refuses "outbox" there).
 */
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/db/seed';

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://gadmo:gadmo_local_only@localhost:5432/gadmo_e2e';

async function resetDatabase(): Promise<void> {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to reset a non-e2e database: ${name}`);
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

async function main(): Promise<void> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: process.env.E2E_API_PORT ?? '4100',
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    OTP_PEPPER: randomBytes(48).toString('base64url'),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WEB_ORIGIN: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3100',
    SMS_PROVIDER: 'outbox',
  });
  await resetDatabase();
  // Fresh rate limits and codes for every run (this Redis database is used only by e2e).
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
  await runMigrations(databaseUrl);
  await seed(databaseUrl);
  await import('../src/main');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
