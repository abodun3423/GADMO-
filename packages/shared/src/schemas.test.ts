import { describe, expect, it } from 'vitest';
import { otpRequestSchema, otpVerifySchema } from './schemas';

describe('auth schemas', () => {
  it('normalises the phone number', () => {
    expect(otpRequestSchema.parse({ phone: '0803 123 4567' })).toEqual({ phone: '+2348031234567' });
  });

  it('rejects unknown fields so clients cannot smuggle data in', () => {
    expect(otpRequestSchema.safeParse({ phone: '08031234567', role: 'admin' }).success).toBe(false);
  });

  it('never allows choosing an admin role at sign-up', () => {
    const result = otpVerifySchema.safeParse({
      phone: '08031234567',
      code: '123456',
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('requires a 6-digit code', () => {
    expect(otpVerifySchema.safeParse({ phone: '08031234567', code: '12345' }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: '08031234567', code: '123456' }).success).toBe(true);
  });
});
