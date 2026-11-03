import { describe, expect, it } from 'vitest';
import {
  otpRequestSchema,
  otpVerifySchema,
  proProfileSchema,
  setOnlineSchema,
  staffLoginSchema,
  staffPasswordSchema,
  staffVerifySchema,
  submitVerificationSchema,
  updateProfileSchema,
  verificationDecisionSchema,
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

describe('identity check', () => {
  it('takes an 11-digit NIN, ignoring spaces and dashes', () => {
    expect(submitVerificationSchema.parse({ nin: '1234 5678-901' }).nin).toBe('12345678901');
    expect(submitVerificationSchema.safeParse({ nin: '1234567890' }).success).toBe(false);
    expect(submitVerificationSchema.safeParse({ nin: '1234567890a' }).success).toBe(false);
  });

  it('needs a note unless the check is approved', () => {
    expect(verificationDecisionSchema.safeParse({ decision: 'APPROVED' }).success).toBe(true);
    expect(verificationDecisionSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(
      verificationDecisionSchema.safeParse({ decision: 'NEEDS_INFO', note: 'Retake the ID photo' })
        .success,
    ).toBe(true);
  });

  it('only switches online with a true or false', () => {
    expect(setOnlineSchema.safeParse({ online: true }).success).toBe(true);
    expect(setOnlineSchema.safeParse({ online: 'yes' }).success).toBe(false);
  });
});

describe('staff sign-in', () => {
  it('lower-cases the email', () => {
    expect(staffLoginSchema.parse({ email: 'Ada@GADMO.ng', password: 'x' }).email).toBe(
      'ada@gadmo.ng',
    );
    expect(staffVerifySchema.parse({ email: 'Ada@GADMO.ng', code: '123456' }).email).toBe(
      'ada@gadmo.ng',
    );
    expect(staffVerifySchema.safeParse({ email: 'ada@gadmo.ng', code: '12345' }).success).toBe(
      false,
    );
  });

  it('wants new passwords of at least 12 characters', () => {
    expect(
      staffPasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      staffPasswordSchema.safeParse({
        currentPassword: 'old',
        newPassword: 'green plantain market',
      }).success,
    ).toBe(true);
  });
});
