import { describe, expect, it } from 'vitest';
import {
  otpRequestSchema,
  otpVerifySchema,
  proProfileSchema,
  updateProfileSchema,
} from './schemas';

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

describe('Pro profile', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const base = { categoryIds: [id(1)], latitude: 7.62, longitude: 5.22, serviceRadiusKm: 10 };

  it('accepts skills, an optional bio and a listed distance', () => {
    expect(proProfileSchema.parse(base).bio).toBe('');
    expect(proProfileSchema.safeParse({ ...base, bio: 'Electrician, 8 years' }).success).toBe(true);
  });

  it('needs 1 to 10 different skills', () => {
    expect(proProfileSchema.safeParse({ ...base, categoryIds: [] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => id(i));
    expect(proProfileSchema.safeParse({ ...base, categoryIds: eleven }).success).toBe(false);
    expect(proProfileSchema.safeParse({ ...base, categoryIds: [id(1), id(1)] }).success).toBe(
      false,
    );
  });

  it('only takes distances from the list, and no extra fields', () => {
    expect(proProfileSchema.safeParse({ ...base, serviceRadiusKm: 7 }).success).toBe(false);
    expect(proProfileSchema.safeParse({ ...base, isOnline: true }).success).toBe(false);
    expect(proProfileSchema.safeParse({ ...base, verificationStatus: 'APPROVED' }).success).toBe(
      false,
    );
  });
});
