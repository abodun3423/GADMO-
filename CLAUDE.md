# Working on GADMO

Source of truth for product decisions: the GADMO PRD v1.0 (https://claude.ai/artifact/N4HEkdBtJKrYrZwNHHVkAV).
Ask the founder before deciding anything the PRD leaves open.

## Non-negotiable product rules

- Customers and Pros never see each other's phone number or email. All contact happens in GADMO chat.
  Run user-written text through `maskContactInfo` from `@gadmo/shared` before storing it.
- Payments: inspection fee in-app at booking; optional materials deposit (max 50% of quote) on quote
  acceptance; balance after the job. In-app balances are held for 12 hours (or until the customer
  confirms) and stay held if the customer reports poor work. Cash balances require the in-app cash
  agreement and carry no GADMO guarantee.
- Money is integer kobo everywhere. Use `@gadmo/shared` money helpers. The ledger is append-only.
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
