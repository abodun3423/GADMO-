# Working on GADMO

Source of truth for product decisions: the GADMO PRD v1.0 (https://claude.ai/artifact/N4HEkdBtJKrYrZwNHHVkAV).
Ask the founder before deciding anything the PRD leaves open.

## Non-negotiable product rules

- Launch area: Ekiti State, starting in Ado-Ekiti.
- Customers and Pros never see each other's phone number or email. All contact happens in GADMO chat.
  Run user-written text through `maskContactInfo` from `@gadmo/shared` before storing it.
- Inspection fee: agreed in chat per job (Pro offers based on distance, urgency and job; customer
  accepts or counters), paid in-app before the visit, and never above ₦5,000 (`MAX_INSPECTION_FEE_KOBO`).
  Only categories with inspection policy REQUIRED or OPTIONAL use it; tech, lessons, beauty, events and
  businesses (policy NONE) quote directly.
- Payments: the customer pays the whole quote (less any inspection fee paid) when accepting it. The
  optional materials deposit (max 50% of quote) goes to the Pro at once; GADMO holds the balance. After
  "Job done" the customer is asked if they are satisfied and can release it at once; otherwise it is
  released automatically 12 hours after "Job done". A report of poor work (allowed from quote acceptance
  until release) keeps it held. There is no cash option: every payment goes through GADMO, so every job is
  covered by the GADMO Guarantee (founder decision, November 2026).
- Commission: 10% (`COMMISSION_BPS`).
- Pros can book services too (customer or Pro account; staff cannot). A booking Pro is never offered or
  listed for their own job, appears to the hired Pro as a normal customer, and uses one wallet: earnings
  pay for bookings and refunds return to it (`bookerWallet`). Ratings they get as a customer stay
  staff-only and never count toward their Pro stars (founder decision, November 2026).
- Wallet: refunds go to the customer's GADMO wallet. When paying (inspection fee, quote, balance) the
  wallet pays first unless the customer unticks it; the card pays the rest, and a payment the wallet
  covers fully is made at once. The wallet part is taken only when the payment is confirmed, under the
  same lock as withdrawals (founder decision, November 2026).
- Pro no-show: after the inspection fee is paid, the Pro must arrive (arrival code) within 2h30 for an
  emergency, or by 1 hour after the booked time. Then the customer can wait 30 minutes longer (while the
  Pro is on the way) or cancel: the fee is refunded to their GADMO wallet at once, the no-show is recorded,
  and a new request goes to other Pros. Staff can record it too; 3 no-shows in 30 days alerts staff
  (founder decision, November 2026).
- Ratings: after a job is complete, each side rates the other once (1–5 stars, optional comment, no
  edits) within 14 days (`REVIEW_WINDOW_DAYS`). Customers' ratings of a Pro make up the Pro's stars and
  are shown to customers without the customer's name; Pros' ratings of a customer are seen only by
  staff (founder decision, November 2026).
- Pro profile: a public page for each verified Pro (skills, stars, price guide, up to 8 work photos,
  reviews; never location or contacts). Work photos show at once; staff remove ones that break the rules
  (founder decision, November 2026).
- Money is integer kobo everywhere. Use `@gadmo/shared` money helpers. The ledger is append-only.
- The service catalogue lives in `apps/api/src/db/categories.ts`; `db:seed` upserts it by slug.
- The client is a lightweight PWA (JS budget < 200 KB gzipped on first load).

## Engineering conventions

- pnpm + Turborepo monorepo; TypeScript strict; Node 22.
- API: NestJS (CommonJS build), Drizzle ORM (`apps/api/src/db/schema.ts`, migrations in `apps/api/drizzle`).
  Generate migrations with `pnpm --filter @gadmo/api db:generate`; never edit an applied migration.
- Validate every request with a strict zod schema via `ZodValidationPipe`.
- Every endpoint returning user data needs an authorization test in `apps/api/test/authorization.int.test.ts`.
- State-changing routes require the `x-gadmo-client: web` header (CSRF guard).
- Before finishing any change: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:integration`.
- Small pull requests, one feature each.
- The founder allows merging a pull request once CI is green and it has no merge conflicts.
