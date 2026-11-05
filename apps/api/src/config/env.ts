import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    WEB_ORIGIN: z.string().min(1),
    /** console = print codes (dev); outbox = store codes in Redis for browser tests; termii = real SMS. */
    SMS_PROVIDER: z.enum(['console', 'outbox', 'termii']).default('console'),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().default('GADMO'),
    /**
     * test = GADMO's own test checkout (no money moves; refused in production);
     * paystack = real Paystack checkout (test or live keys).
     */
    PAYMENT_PROVIDER: z.enum(['test', 'paystack']).default('test'),
    PAYSTACK_SECRET_KEY: z
      .string()
      .regex(/^sk_(test|live)_\w+$/, 'PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /**
     * Web push (VAPID) keys, from `npx web-push generate-vapid-keys`. Required in
     * production; in development GADMO makes a pair once and keeps it in apps/api/.vapid.dev.json.
     */
    VAPID_PUBLIC_KEY: z
      .string()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    VAPID_PRIVATE_KEY: z
      .string()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    VAPID_SUBJECT: z.string().default('mailto:support@gadmo.ng'),
    /** Login codes one network address may request per hour (raised only for browser tests). */
    OTP_IP_HOURLY_LIMIT: z.coerce.number().int().positive().default(30),
    /** 32 random bytes, base64: encrypts NINs and identity photos (AES-256-GCM). */
    FIELD_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    }),
    /**
     * Development only: a fixed 6-digit code that always signs in, for computers where
     * stored codes vanish (e.g. a jumping WSL/Docker clock). Refused outside development.
     */
    DEV_LOGIN_CODE: z
      .string()
      .regex(/^\d{6}$/, 'DEV_LOGIN_CODE must be 6 digits')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER !== 'termii') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: `The ${env.SMS_PROVIDER} SMS provider exposes login codes and must never run in production`,
      });
    }
    if (env.DEV_LOGIN_CODE && env.NODE_ENV !== 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_LOGIN_CODE'],
        message: 'DEV_LOGIN_CODE lets anyone sign in and only works when NODE_ENV=development',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER !== 'paystack') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'The test checkout moves no money and must never run in production',
      });
    }
    if (env.PAYMENT_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYSTACK_SECRET_KEY'],
        message: 'PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack',
      });
    }
    if (env.NODE_ENV === 'production' && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required in production (web push)',
      });
    }
    if (env.NODE_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'WEB_ORIGIN must be https in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

/** Fails fast at startup with a readable list of missing or invalid settings (values are never printed). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
