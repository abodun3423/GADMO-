# GADMO security

GADMO handles identity data, home locations and money. Security is a launch blocker, not a later phase.
Targets: OWASP ASVS Level 2 for the API; a strict Content Security Policy for the PWA.

## Reporting a vulnerability

Email the founder privately (address to be added before launch). Do not open a public issue.

## What is in place (Phase 0)

| Area                       | Control                                                                                                                                                                                         | Where                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Login                      | Phone + 6-digit OTP; codes stored only as HMAC-SHA256 with a server pepper; 5-minute expiry; single use; destroyed after 5 wrong guesses                                                        | `apps/api/src/auth/otp.service.ts`                          |
| Brute force                | OTP requests limited to 3 per phone per 10 min, 10 per phone per day, 30 per IP per hour                                                                                                        | `otp.service.ts`, `common/rate-limit.ts`                    |
| Sessions                   | 15-minute JWT access token (HS256, issuer + audience checked); 30-day opaque refresh token stored as SHA-256 hash; rotation on every use; replaying an old token revokes the whole login family | `auth/token.service.ts`                                     |
| Cookies                    | `HttpOnly`; `Secure` in production; access `SameSite=Lax`; refresh `SameSite=Strict` and scoped to `/v1/auth`                                                                                   | `auth/cookies.ts`                                           |
| CSRF                       | Every POST/PUT/PATCH/DELETE must carry the `x-gadmo-client: web` header, which browsers cannot add cross-site; CORS allows only `WEB_ORIGIN`                                                    | `auth/guards.ts`, `configure-app.ts`                        |
| Access control             | Role and account status re-read from the database on each request (bans apply instantly); admin roles cannot be chosen at sign-up                                                               | `auth/guards.ts`, `auth/auth.service.ts`                    |
| Object-level authorization | Jobs visible only to their customer, assigned Pro or staff; others get 404                                                                                                                      | `jobs/jobs.controller.ts`, `test/authorization.int.test.ts` |
| No contact details         | Phone numbers never returned for other users; phone numbers, bank accounts, emails, links and handles masked in user text; off-app attempts flagged                                             | `packages/shared/src/contact-masking.ts`                    |
| Input                      | Every body and param validated with strict zod schemas (unknown fields rejected); 100 KB body limit                                                                                             | `common/zod-validation.pipe.ts`                             |
| Money integrity            | Whole kobo only; ledger and audit log are append-only, enforced by database triggers; deposit cap enforced by a database CHECK                                                                  | `apps/api/drizzle/*.sql`, `src/db/schema.ts`                |
| HTTP headers               | Helmet defaults (CSP, HSTS, nosniff, frameguard), `x-powered-by` removed                                                                                                                        | `configure-app.ts`                                          |
| Configuration              | Startup fails on missing or short secrets; console SMS and non-HTTPS origins refused in production; secret values never printed                                                                 | `config/env.ts`                                             |
| Logs                       | Phone numbers redacted to the last 2 digits                                                                                                                                                     | `packages/shared/src/phone.ts`                              |
| Supply chain               | Lockfile installs, `pnpm audit` (high+), Dependabot, CodeQL `security-extended`, gitleaks on every push                                                                                         | `.github/`                                                  |

## Content Security Policy for the PWA (live, `apps/web/proxy.ts`)

Every page gets a fresh random nonce; only scripts and styles carrying it can run.

```
default-src 'self';
script-src 'self' 'nonce-{per request}' 'strict-dynamic';
style-src 'self' 'nonce-{per request}';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

No `unsafe-inline` or `unsafe-eval` in production (development adds `unsafe-eval` for React's
error overlay). Inline `style=""` attributes are blocked, so components use CSS classes only.
The browser only talks to the web app's own origin: `/v1/*` is forwarded server-side to the API
(`apps/web/app/v1/[...path]/route.ts`), so the API never needs to be exposed to browsers directly.

When payments and maps arrive, only these will be added, after review:
`https://js.paystack.co` and `https://checkout.paystack.com` (Paystack), and Google Maps hosts.
The browser tests fail if any page triggers a CSP violation.

## Test-only login code delivery

`SMS_PROVIDER=outbox` stores the last login code per phone in Redis so browser tests can sign in.
It has no HTTP endpoint, and the API refuses to start with `console` or `outbox` in production.

## Identity check data (NIN, ID photo, selfie)

- The NIN and both photos are encrypted with AES-256-GCM (`FIELD_ENCRYPTION_KEY`, 32 bytes) before
  they are stored. A keyed hash of the NIN (`nin_hash`) lets staff spot one NIN on several accounts
  without decrypting it.
- Photos are accepted only as JPEG, PNG or WebP, checked by their first bytes (not the
  Content-Type header), up to 2 MB. Phones shrink and re-encode them first, which drops location
  metadata.
- No API route returns a NIN or a photo to the Pro or to customers. Only staff (ADMIN or
  SUPER_ADMIN) can read them, in /admin; each view of a NIN, ID photo or selfie, and each decision,
  is written to the audit log. Photos are sent with `Cache-Control: no-store`.
- Staff accounts can't be created in the app: `pnpm admin:grant <phone> <email>` needs server
  access, never converts a Pro, asks for the password without showing or logging it, and is
  audit-logged.

## Staff sign-in (separate from customers and Pros)

- Staff sign in at `/staff` with email + password (scrypt, N=2^15) **and** a code sent to their
  phone. The code step only works within 5 minutes of a correct password, in the same browser: the
  proof is a signed httpOnly cookie (path `/v1/auth/staff`), checked against the API clock rather than
  Redis expiry, and usable for one sign-in only.
- Staff numbers are refused by the customer/Pro sign-in, and customer/Pro accounts are refused by
  the staff sign-in. Wrong passwords and unknown emails get the same answer in the same time.
- Staff sessions end 12 hours after sign-in; renewing the access token does not extend them.
- Sign-ins and password changes are audit-logged; password guesses are rate limited per email
  and per network address.
- Photos live in the `private_files` table for now; they move to private object storage later.

## Rules for contributors

- Never commit secrets. Use `.env` locally and GitHub Actions secrets / host secrets in deployment.
- Money is always integer kobo. Use the helpers in `@gadmo/shared/money`.
- Every new endpoint that returns user data needs a test in `test/authorization.int.test.ts`
  proving another user cannot read it.
- User-written text (chat, job descriptions, reviews) must pass through `maskContactInfo` before storage.
- Ledger corrections are new reversing entries, never edits.

## Still to do before public launch

Field-level encryption (NIN, bank details, addresses), Paystack webhook signature checks, KYC
integration, admin two-factor login, Sentry with PII scrubbing, k6 load test, OWASP ZAP baseline,
external penetration test, NDPA privacy policy and data-subject request flow, and legal review of
the cash agreement wording.
