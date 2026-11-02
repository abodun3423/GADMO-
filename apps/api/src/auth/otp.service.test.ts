import type Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env';
import { OtpService } from './otp.service';
import type { SmsSender } from './sms';

/** Redis that never holds a code: any real check fails with "invalid". */
function emptyRedis(): Redis {
  const chain = {
    incr: () => chain,
    expire: () => chain,
    exec: async () => [[null, 1]],
  };
  return {
    multi: () => chain,
    get: async () => null,
    del: async () => 0,
  } as unknown as Redis;
}

const sms: SmsSender = { send: async () => undefined };
const env = (overrides: Partial<Env>) =>
  ({ OTP_PEPPER: 'p'.repeat(32), NODE_ENV: 'development', ...overrides }) as Env;

describe('OtpService DEV_LOGIN_CODE', () => {
  it('signs in with the dev code in development', async () => {
    const otp = new OtpService(emptyRedis(), sms, env({ DEV_LOGIN_CODE: '123456' }));
    await expect(otp.verify('+2348031234567', '123456')).resolves.toBe('ok');
    await expect(otp.verify('+2348031234567', '654321')).resolves.toBe('invalid');
  });

  it('ignores the dev code outside development', async () => {
    for (const NODE_ENV of ['test', 'production'] as const) {
      const otp = new OtpService(emptyRedis(), sms, env({ NODE_ENV, DEV_LOGIN_CODE: '123456' }));
      await expect(otp.verify('+2348031234567', '123456')).resolves.toBe('invalid');
    }
  });

  it('does nothing when no dev code is set', async () => {
    const otp = new OtpService(emptyRedis(), sms, env({}));
    await expect(otp.verify('+2348031234567', '123456')).resolves.toBe('invalid');
  });
});
