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

/** Most Pros offer one trade; a few related ones (e.g. plumber + water pump) are allowed. */
export const MAX_PRO_SKILLS = 10;
export const SERVICE_RADIUS_KM = [5, 10, 20, 30, 50] as const;

/** What a Pro offers and where. The bio is masked for contact details before it is stored. */
export const proProfileSchema = z
  .object({
    categoryIds: z
      .array(z.uuid())
      .min(1, 'Choose at least one skill')
      .max(MAX_PRO_SKILLS, `Choose up to ${MAX_PRO_SKILLS} skills`)
      .refine((ids) => new Set(ids).size === ids.length, 'Each skill only once'),
    bio: z.string().trim().max(500, 'Keep it under 500 characters').default(''),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    serviceRadiusKm: z
      .number()
      .int()
      .refine((km) => (SERVICE_RADIUS_KM as readonly number[]).includes(km), {
        message: 'Choose a distance from the list',
      }),
  })
  .strict();
export type ProProfileInput = z.infer<typeof proProfileSchema>;
