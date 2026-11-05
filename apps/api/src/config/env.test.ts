import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/gadmo',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
  WEB_ORIGIN: 'http://localhost:3000',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
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
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', SMS_PROVIDER: 'outbox' })).toThrow(
      /SMS_PROVIDER/,
    );
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'termii',
        WEB_ORIGIN: 'http://gadmo.ng',
      }),
    ).toThrow(/https/);
  });

  it('needs a 32-byte encryption key', () => {
    expect(() => loadEnv({ ...valid, FIELD_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
    expect(() => loadEnv({ ...valid, FIELD_ENCRYPTION_KEY: undefined })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });

  it('uses the test checkout by default, never in production, and Paystack needs a key', () => {
    expect(loadEnv(valid).PAYMENT_PROVIDER).toBe('test');
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      SMS_PROVIDER: 'termii',
      WEB_ORIGIN: 'https://gadmo.ng',
    };
    expect(() => loadEnv(prod)).toThrow(/PAYMENT_PROVIDER/);
    expect(() => loadEnv({ ...valid, PAYMENT_PROVIDER: 'paystack' })).toThrow(
      /PAYSTACK_SECRET_KEY/,
    );
    expect(() =>
      loadEnv({ ...valid, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'pk_test_fake_only' }),
    ).toThrow(/sk_test_/);
    expect(
      loadEnv({ ...prod, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_live_fake_only' })
        .PAYMENT_PROVIDER,
    ).toBe('paystack');
  });

  it('allows DEV_LOGIN_CODE only in development', () => {
    expect(loadEnv({ ...valid, DEV_LOGIN_CODE: '123456' }).DEV_LOGIN_CODE).toBe('123456');
    expect(loadEnv({ ...valid, DEV_LOGIN_CODE: '' }).DEV_LOGIN_CODE).toBeUndefined();
    expect(() => loadEnv({ ...valid, DEV_LOGIN_CODE: '12345' })).toThrow(/6 digits/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'test', DEV_LOGIN_CODE: '123456' })).toThrow(
      /DEV_LOGIN_CODE/,
    );
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'termii',
        WEB_ORIGIN: 'https://gadmo.ng',
        DEV_LOGIN_CODE: '123456',
      }),
    ).toThrow(/DEV_LOGIN_CODE/);
  });
});
