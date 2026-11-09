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

describe('OtpService pilot (demo accounts, SMS disabled)', () => {
  const pilot = env({
    NODE_ENV: 'production',
    SMS_PROVIDER: 'disabled',
    DEMO_LOGIN_CODE: '482915',
  });

  it('signs in demo numbers only, with the demo code only', async () => {
    const otp = new OtpService(emptyRedis(), sms, pilot);
    await expect(otp.verify('+2347000000001', '482915')).resolves.toBe('ok');
    await expect(otp.verify('+2347000000001', '000000')).resolves.toBe('invalid');
    await expect(otp.verify('+2348031234567', '482915')).resolves.toBe('invalid');
  });

  it('sends no SMS to demo numbers and refuses real numbers while SMS is off', async () => {
    const sent: string[] = [];
    const recorder: SmsSender = { send: async (to) => void sent.push(to) };
    const redis = {
      ...emptyRedis(),
      multi: () => {
        const chain = {
          incr: () => chain,
          expire: () => chain,
          set: () => chain,
          del: () => chain,
          ttl: () => chain,
          exec: async () => [[null, 1]],
        };
        return chain;
      },
    } as unknown as Redis;
    const otp = new OtpService(redis, recorder, pilot);
    await expect(otp.request('+2347000000001', '1.2.3.4')).resolves.toBeUndefined();
    await expect(otp.request('+2348031234567', '1.2.3.4')).rejects.toThrow(/pilot/);
    expect(sent).toEqual([]);
  });
});
