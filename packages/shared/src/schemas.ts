import { z } from 'zod';
import { normalizeNigerianPhone } from './phone';

export const ROLES = ['customer', 'pro', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

export const phoneSchema = z
  .string()
  .max(20)
  .transform((value, ctx) => {
    const normalized = normalizeNigerianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian mobile number' });
      return z.NEVER;
    }
    return normalized;
  });

export const otpRequestSchema = z.object({ phone: phoneSchema }).strict();
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    code: z.string().regex(/^\d{6}$/, 'The code has 6 digits'),
    /** Chosen at sign-up only; admins are never created through the public API. */
    role: z.enum(['customer', 'pro']).optional(),
  })
  .strict();
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/**
 * The name other people see in GADMO (customers and Pros). Letters, spaces and
 * . ' - only (a dot only after a word), so a phone number, email or link can never be hidden in it.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Enter at least 2 letters')
      .max(60, 'Keep it under 60 characters')
      .regex(
        // A dot only after a word ("Dr. Bola"), so "www.site.ng" is refused.
        /^\p{L}(?:[\p{L}\p{M} '’-]|\.(?=\s|$))*$/u,
        'Use letters only (no numbers, emails or links)',
      ),
  );

export const updateProfileSchema = z.object({ name: displayNameSchema }).strict();
export type UpdateProfile = z.infer<typeof updateProfileSchema>;
