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

/** A web link on one of the given sites (or any site when none are given), https only. */
function linkOn(hosts: readonly string[], message: string) {
  return z
    .string()
    .trim()
    .max(300)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(
      z.url({ protocol: /^https$/, message }).refine((v) => {
        let host: string;
        try {
          host = new URL(v).hostname.toLowerCase();
        } catch {
          return false;
        }
        return hosts.length === 0 || hosts.some((h) => host === h || host.endsWith(`.${h}`));
      }, message),
    );
}

/**
 * Links a tech Pro gives so staff can check their work (founder decision: staff only,
 * never shown to customers, so all contact stays in GADMO chat). All optional.
 */
export const techLinksSchema = z
  .object({
    linkedin: linkOn(['linkedin.com'], 'Enter your LinkedIn profile link').optional(),
    github: linkOn(['github.com'], 'Enter your GitHub profile link').optional(),
    portfolio: linkOn([], 'Enter a link to your portfolio or website').optional(),
  })
  .strict();
export type TechLinks = z.infer<typeof techLinksSchema>;

/**
 * Stage 1 of Pro verification (founder decision): identity, plus where and with whom the
 * Pro learned their trade. A photo of an attestation letter or a certificate is uploaded
 * separately; at least one is required.
 */
export const submitVerificationSchema = z
  .object({
    nin: ninSchema,
    /** The workshop, master's business or school where they learned. */
    trainedAt: z.string().trim().min(2, 'Tell us where you learned').max(120),
    /** The master, teacher or instructor who trained them. */
    trainedBy: z.string().trim().min(2, 'Tell us who trained you').max(80),
    /** So staff can call the trainer to confirm. Seen by GADMO staff only. */
    trainerPhone: phoneSchema.optional(),
    links: techLinksSchema.optional(),
  })
  .strict();
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

/** Staff book the in-person skill check: when, and where the agent will go. */
export const scheduleSkillCheckSchema = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }),
    visitPlace: z.string().trim().min(3, 'Say where the agent will go').max(200),
  })
  .strict();
export type ScheduleSkillCheck = z.infer<typeof scheduleSkillCheckSchema>;

/**
 * The agent's finding after the visit. A note is always required: what they saw, so the
 * record is useful later, and so a Pro who did not pass knows why.
 */
export const skillCheckResultSchema = z
  .object({
    result: z.enum(['PASSED', 'FAILED']),
    note: z.string().trim().min(5, 'Say what you saw (at least a few words)').max(1000),
  })
  .strict();
export type SkillCheckResult = z.infer<typeof skillCheckResultSchema>;

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

/** Wallet withdrawals: the smallest amount (founder decision: ₦1,000; GADMO pays the fee). */
export const MIN_WITHDRAWAL_KOBO = 100_000;

/** The bank account a person withdraws to (Nigerian 10-digit NUBAN). */
export const bankAccountSchema = z
  .object({
    bankCode: z.string().regex(/^[0-9A-Za-z]{2,12}$/, 'Choose your bank.'),
    accountNumber: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(z.string().regex(/^\d{10}$/, 'Your account number has 10 digits.')),
  })
  .strict();
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export const withdrawalSchema = z
  .object({
    amountKobo: z
      .number()
      .int()
      .min(MIN_WITHDRAWAL_KOBO, 'You can withdraw ₦1,000 or more.')
      .max(100_000_000_00)
      .refine((v) => v % 100 === 0, 'Withdraw whole naira.'),
  })
  .strict();
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;

/** The largest quote GADMO takes in the app (₦10,000,000). */
export const MAX_QUOTE_KOBO = 1_000_000_000;

/**
 * A Pro's quote: the whole job price (the inspection fee already paid counts toward it), an
 * optional materials deposit of at most half, and what it covers. Whole naira only.
 */
export const quoteSchema = z
  .object({
    amountKobo: z
      .number()
      .int()
      .min(100, 'Enter the price in naira.')
      .max(MAX_QUOTE_KOBO, 'Quotes above ₦10,000,000 can’t be paid in GADMO yet.')
      .refine((v) => v % 100 === 0, 'Use whole naira.'),
    depositKobo: z
      .number()
      .int()
      .min(0)
      .refine((v) => v % 100 === 0, 'Use whole naira.')
      .default(0),
    description: z.string().trim().min(5, 'Say what the price covers.').max(1000),
  })
  .strict()
  .refine((q) => q.depositKobo * 2 <= q.amountKobo, {
    message: 'The deposit can be at most half the quote.',
    path: ['depositKobo'],
  });
export type QuoteInput = z.infer<typeof quoteSchema>;
