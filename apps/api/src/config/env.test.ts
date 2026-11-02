import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/gadmo',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('accepts a complete development config', () => {
    expect(loadEnv(valid).SMS_PROVIDER).toBe('console');
  });

  it('rejects short secrets without printing their values', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short-secret' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short-secret' })).not.toThrow(
      /short-secret/,
    );
  });

  it('refuses the console SMS provider and plain http in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'termii',
        WEB_ORIGIN: 'http://gadmo.ng',
      }),
    ).toThrow(/https/);
  });
});
