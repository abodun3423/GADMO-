import { describe, expect, it } from 'vitest';
import {
  MAX_QUOTE_KOBO,
  quoteSchema,
  bankAccountSchema,
  callSdpSchema,
  deletionRequestSchema,
  MIN_WITHDRAWAL_KOBO,
  shareLocationSchema,
  withdrawalSchema,
  otpRequestSchema,
  otpVerifySchema,
  proProfileSchema,
  setOnlineSchema,
  staffLoginSchema,
  staffPasswordSchema,
  staffVerifySchema,
  scheduleSkillCheckSchema,
  skillCheckResultSchema,
  submitVerificationSchema,
  techLinksSchema,
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
  const training = { trainedAt: 'Adeyemi Auto Workshop, Ado-Ekiti', trainedBy: 'Mr Adeyemi' };

  it('takes an 11-digit NIN, ignoring spaces and dashes', () => {
    expect(submitVerificationSchema.parse({ nin: '1234 5678-901', ...training }).nin).toBe(
      '12345678901',
    );
    expect(submitVerificationSchema.safeParse({ nin: '1234567890', ...training }).success).toBe(
      false,
    );
    expect(submitVerificationSchema.safeParse({ nin: '1234567890a', ...training }).success).toBe(
      false,
    );
  });

  it('needs where and with whom the Pro trained; the trainer phone is optional', () => {
    const nin = '12345678901';
    expect(submitVerificationSchema.safeParse({ nin }).success).toBe(false);
    expect(submitVerificationSchema.safeParse({ nin, ...training, trainedBy: ' ' }).success).toBe(
      false,
    );
    expect(
      submitVerificationSchema.parse({ nin, ...training, trainerPhone: '0803 123 4567' })
        .trainerPhone,
    ).toBe('+2348031234567');
    expect(
      submitVerificationSchema.safeParse({ nin, ...training, trainerPhone: '12' }).success,
    ).toBe(false);
  });

  it('takes tech links only on the right sites, over https', () => {
    expect(
      techLinksSchema.parse({
        linkedin: 'linkedin.com/in/ada',
        github: 'https://github.com/ada',
        portfolio: 'ada.dev',
      }),
    ).toEqual({
      linkedin: 'https://linkedin.com/in/ada',
      github: 'https://github.com/ada',
      portfolio: 'https://ada.dev',
    });
    expect(techLinksSchema.parse({ linkedin: 'https://ng.linkedin.com/in/ada' }).linkedin).toBe(
      'https://ng.linkedin.com/in/ada',
    );
    expect(techLinksSchema.safeParse({ linkedin: 'https://evil-linkedin.com/x' }).success).toBe(
      false,
    );
    expect(techLinksSchema.safeParse({ github: 'https://gitlab.com/ada' }).success).toBe(false);
    expect(techLinksSchema.safeParse({ portfolio: 'http://ada.dev' }).success).toBe(false);
    expect(techLinksSchema.safeParse({ portfolio: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('books a skill check with a time and a place, and records it with a note', () => {
    expect(
      scheduleSkillCheckSchema.safeParse({
        scheduledAt: '2026-11-20T10:00:00+01:00',
        visitPlace: 'His workshop, Ajilosun, Ado-Ekiti',
      }).success,
    ).toBe(true);
    expect(
      scheduleSkillCheckSchema.safeParse({ scheduledAt: 'tomorrow', visitPlace: 'Workshop' })
        .success,
    ).toBe(false);
    expect(
      scheduleSkillCheckSchema.safeParse({ scheduledAt: '2026-11-20T10:00:00Z' }).success,
    ).toBe(false);
    expect(
      skillCheckResultSchema.safeParse({ result: 'PASSED', note: 'Good tools, neat wiring.' })
        .success,
    ).toBe(true);
    expect(skillCheckResultSchema.safeParse({ result: 'PASSED' }).success).toBe(false);
    expect(skillCheckResultSchema.safeParse({ result: 'PENDING', note: 'Not yet' }).success).toBe(
      false,
    );
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

describe('wallet, chat extras and account schemas', () => {
  it('bank accounts: a 10-digit number (spaces allowed) and a bank code', () => {
    expect(bankAccountSchema.parse({ bankCode: '058', accountNumber: '0123 456 789' })).toEqual({
      bankCode: '058',
      accountNumber: '0123456789',
    });
    expect(bankAccountSchema.safeParse({ bankCode: '058', accountNumber: '12345' }).success).toBe(
      false,
    );
    expect(bankAccountSchema.safeParse({ bankCode: '', accountNumber: '0123456789' }).success).toBe(
      false,
    );
  });

  it('withdrawals: ₦1,000 or more, whole naira', () => {
    expect(withdrawalSchema.safeParse({ amountKobo: MIN_WITHDRAWAL_KOBO }).success).toBe(true);
    expect(withdrawalSchema.safeParse({ amountKobo: 99_900 }).success).toBe(false);
    expect(withdrawalSchema.safeParse({ amountKobo: 150_050 }).success).toBe(false);
    expect(withdrawalSchema.safeParse({ amountKobo: 200_000, to: 'x' }).success).toBe(false);
  });

  it('location pins, call details and deletion requests', () => {
    expect(shareLocationSchema.safeParse({ latitude: 7.62, longitude: 5.22 }).success).toBe(true);
    expect(shareLocationSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(callSdpSchema.safeParse({ sdp: 'v=0\r\no=- 1 2 IN IP4 0.0.0.0' }).success).toBe(true);
    expect(callSdpSchema.safeParse({ sdp: 'x' }).success).toBe(false);
    expect(deletionRequestSchema.parse({ reason: '  moving  ' })).toEqual({ reason: 'moving' });
    expect(deletionRequestSchema.safeParse({}).success).toBe(true);
    expect(deletionRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('quotes', () => {
  it('a price in whole naira, a deposit of at most half, and what it covers', () => {
    const ok = quoteSchema.parse({ amountKobo: 3_000_000, description: '  Cake for 30  ' });
    expect(ok).toEqual({ amountKobo: 3_000_000, depositKobo: 0, description: 'Cake for 30' });
    expect(
      quoteSchema.safeParse({ amountKobo: 3_000_000, depositKobo: 1_500_000, description: 'Cake' })
        .success,
    ).toBe(false); // too short a description
    expect(
      quoteSchema.safeParse({
        amountKobo: 3_000_000,
        depositKobo: 1_600_000,
        description: 'A cake',
      }).success,
    ).toBe(false);
    expect(
      quoteSchema.safeParse({ amountKobo: 3_000_050, description: 'A big cake' }).success,
    ).toBe(false);
    expect(
      quoteSchema.safeParse({ amountKobo: MAX_QUOTE_KOBO + 100, description: 'A big cake' })
        .success,
    ).toBe(false);
    expect(
      quoteSchema.safeParse({ amountKobo: 3_000_000, depositKobo: 50, description: 'A big cake' })
        .success,
    ).toBe(false);
  });
});
