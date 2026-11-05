import { z } from 'zod';
import { normalizeNigerianPhone } from './phone';
import { MAX_INSPECTION_FEE_KOBO } from './money';

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

export const setOnlineSchema = z.object({ online: z.boolean() }).strict();
export type SetOnline = z.infer<typeof setOnlineSchema>;

/**
 * Emergency dispatch (founder decision, PRD section 5): each Pro, nearest first, gets this
 * long to accept before the request moves to the next Pro. If nobody accepts, the request
 * stays open and is offered to matching Pros as they come online.
 */
export const EMERGENCY_OFFER_SECONDS = 120;

/** National Identification Number: 11 digits (spaces and dashes are ignored). */
export const ninSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{11}$/, 'Your NIN has 11 digits'));

export const submitVerificationSchema = z.object({ nin: ninSchema }).strict();
export type SubmitVerification = z.infer<typeof submitVerificationSchema>;

/** A staff decision on an identity check. A note is required unless it is approved. */
export const verificationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_INFO']),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'APPROVED' || (v.note && v.note.length >= 5), {
    message: 'Tell the Pro what to fix (at least a few words)',
    path: ['note'],
  });
export type VerificationDecision = z.infer<typeof verificationDecisionSchema>;

/** GADMO staff sign in with email + password, then a code sent to their phone. */
export const staffLoginSchema = z
  .object({
    email: z
      .email()
      .max(200)
      .transform((v) => v.trim().toLowerCase()),
    password: z.string().min(1).max(200),
  })
  .strict();
export type StaffLogin = z.infer<typeof staffLoginSchema>;

export const staffVerifySchema = z
  .object({
    email: z
      .email()
      .max(200)
      .transform((v) => v.trim().toLowerCase()),
    code: z.string().regex(/^\d{6}$/, 'The code has 6 digits'),
  })
  .strict();
export type StaffVerify = z.infer<typeof staffVerifySchema>;

/** Staff passwords: at least 12 characters (a few words is easier to remember than symbols). */
export const staffPasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12, 'Use at least 12 characters')
      .max(200, 'Keep it under 200 characters'),
  })
  .strict();
export type StaffPassword = z.infer<typeof staffPasswordSchema>;

/** A chat message. Contact details are masked by the server before it is stored. */
export const MAX_MESSAGE_LENGTH = 1000;
export const sendMessageSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Write a message')
      .max(MAX_MESSAGE_LENGTH, `Keep it under ${MAX_MESSAGE_LENGTH} characters`),
  })
  .strict();
export type SendMessage = z.infer<typeof sendMessageSchema>;

/** A location pin dropped in the chat. */
export const shareLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
export type ShareLocation = z.infer<typeof shareLocationSchema>;

/**
 * An inspection-fee offer or counter-offer: whole naira, more than ₦0 and never above
 * ₦5,000 (MAX_INSPECTION_FEE_KOBO). The note says why (distance, urgency…).
 */
export const inspectionOfferSchema = z
  .object({
    amountKobo: z
      .number()
      .int()
      .positive('Enter an amount')
      .max(MAX_INSPECTION_FEE_KOBO, 'The inspection fee can’t be more than ₦5,000')
      .refine((k) => k % 100 === 0, 'Use whole naira'),
    note: z.string().trim().max(200, 'Keep the note under 200 characters').optional(),
  })
  .strict();
export type InspectionOfferInput = z.infer<typeof inspectionOfferSchema>;

/** Staff changing an account's status. A reason is always recorded in the audit log. */
export const userStatusChangeSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
    reason: z.string().trim().min(5, 'Give a short reason').max(500),
  })
  .strict();
export type UserStatusChange = z.infer<typeof userStatusChangeSchema>;

/**
 * Scheduled jobs: the customer chooses a Pro, who has this long to answer (but never
 * later than an hour before the appointment, and never less than 30 minutes).
 */
export const SCHEDULED_REQUEST_HOURS = 24;

export const chooseProSchema = z.object({ proId: z.uuid() }).strict();
export type ChoosePro = z.infer<typeof chooseProSchema>;

/** In-app calls: how long a call rings before it counts as missed. */
export const CALL_RING_SECONDS = 45;

/** A browser's WebRTC connection details (SDP), offered or answered. */
export const callSdpSchema = z.object({ sdp: z.string().min(10).max(20_000) }).strict();
export type CallSdp = z.infer<typeof callSdpSchema>;

/** Asking GADMO to delete your account; the reason is optional. */
export const deletionRequestSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;
