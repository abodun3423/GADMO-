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

## Content Security Policy for the PWA (to apply when `apps/web` is added)

```
default-src 'self';
script-src 'self' https://js.paystack.co https://maps.googleapis.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com;
connect-src 'self' https://api.gadmo.ng https://*.googleapis.com;
frame-src https://checkout.paystack.com;
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

No other third-party scripts. Any change to this list needs review.

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
