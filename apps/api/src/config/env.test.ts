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
        SMS_API_KEY: 'test-only-termii-key',
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
      SMS_API_KEY: 'test-only-termii-key',
      WEB_ORIGIN: 'https://gadmo.ng',
      VAPID_PUBLIC_KEY: 'test-only-vapid-public',
      VAPID_PRIVATE_KEY: 'test-only-vapid-private',
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

  it('needs web push keys in production', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      SMS_PROVIDER: 'termii',
      SMS_API_KEY: 'test-only-termii-key',
      WEB_ORIGIN: 'https://gadmo.ng',
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_live_fake_only',
    };
    expect(() => loadEnv(prod)).toThrow(/VAPID_PUBLIC_KEY/);
    expect(loadEnv(valid).VAPID_PUBLIC_KEY).toBeUndefined();
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
        SMS_API_KEY: 'test-only-termii-key',
        WEB_ORIGIN: 'https://gadmo.ng',
        DEV_LOGIN_CODE: '123456',
      }),
    ).toThrow(/DEV_LOGIN_CODE/);
  });

  it('allows a pilot with SMS disabled, needs a Termii key, and checks the demo code', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://gadmo.ng',
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_test_fake_key',
      VAPID_PUBLIC_KEY: 'test-only-vapid-public',
      VAPID_PRIVATE_KEY: 'test-only-vapid-private',
    };
    expect(
      loadEnv({ ...prod, SMS_PROVIDER: 'disabled', DEMO_LOGIN_CODE: '482915' }).SMS_PROVIDER,
    ).toBe('disabled');
    expect(() => loadEnv({ ...prod, SMS_PROVIDER: 'termii' })).toThrow(/SMS_API_KEY/);
    expect(loadEnv({ ...prod, SMS_PROVIDER: 'termii', SMS_API_KEY: 'k' }).SMS_CHANNEL).toBe('dnd');
    expect(() => loadEnv({ ...prod, SMS_PROVIDER: 'disabled', DEMO_LOGIN_CODE: '12' })).toThrow(
      /6 digits/,
    );
  });
});
