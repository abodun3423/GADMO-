import { describe, expect, it } from 'vitest';
import { otpRequestSchema, otpVerifySchema, updateProfileSchema } from './schemas';

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

describe('profile name', () => {
  const name = (value: string) => updateProfileSchema.safeParse({ name: value });

  it('accepts real names, including Yoruba letters, and tidies spaces', () => {
    expect(name('  Abiodun   Teahingbola ').data?.name).toBe('Abiodun Teahingbola');
    expect(name('Adéṣọlá Ọ̀ṣun').success).toBe(true);
    expect(name("Mary-Jane O'Neil").success).toBe(true);
    expect(name('Dr. Bola Ade').success).toBe(true);
  });

  it('refuses phone numbers, emails, links and handles hidden in a name', () => {
    for (const bad of ['Tunde 08031234567', 'tunde@gmail.com', 'www.tunde.ng', '@tunde', 'A']) {
      expect(name(bad).success, bad).toBe(false);
    }
  });

  it('allows only the name field', () => {
    expect(updateProfileSchema.safeParse({ name: 'Bola', role: 'ADMIN' }).success).toBe(false);
  });
});
