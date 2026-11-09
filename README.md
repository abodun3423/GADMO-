# GADMO

**The Right Skills. Within Reach.** A lightweight marketplace (PWA) connecting people in Nigeria with
verified, nearby skilled professionals.

Product requirements: [GADMO PRD v1.0](https://claude.ai/artifact/N4HEkdBtJKrYrZwNHHVkAV) · Security: [SECURITY.md](SECURITY.md)

## Repository layout

| Path              | What it is                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS API, Drizzle ORM, PostgreSQL, Redis                                                      |
| `packages/shared` | Rules shared by API and web app: phone numbers, contact masking, money in kobo, request schemas |
| `apps/web`        | Next.js PWA: sign-in, service catalogue, job requests, My jobs                                  |

## Put it online

[docs/DEPLOY.md](docs/DEPLOY.md): one Render Blueprint (`render.yaml`) creates the web app, private
API, database and Redis, starting in pilot mode (demo accounts, Paystack test mode).

## Run it locally

**On Windows with VS Code and Ubuntu (WSL)**, follow [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). In short:
`pnpm services:up`, `pnpm setup:local`, `pnpm check-setup`, then `pnpm dev` (API and app together).
After every `git pull`, run `pnpm update:local`. `pnpm check` runs everything CI checks.

Requirements: Node 22+, pnpm 10, and Docker Desktop (or your own Postgres 16 + Redis 7).
Works on Windows, macOS and Linux.

```bash
pnpm install
docker compose up -d   # Postgres + PostGIS and Redis, reachable only from your computer
pnpm setup:local       # creates apps/api/.env with fresh secrets, migrates and seeds the database
pnpm dev:api           # starts the API on http://localhost:4000 (check http://localhost:4000/health)
```

Then, in a second terminal, start the app and open http://localhost:3000:

```bash
pnpm dev:web           # the PWA; it forwards /v1/* to the API
```

Or run the guided walkthrough of the API instead:

```bash
pnpm demo              # signs up test users, posts a job, checks privacy and money rules
```

In development, login codes are printed in the API console (the `pnpm dev:api` window) instead of
being sent by SMS.
`apps/api/.env` holds local secrets; it is git-ignored and must never be committed.

**Testing as a Pro:** sign up choosing "I offer a skill or service", set up your Pro profile, then
either send an identity check and approve it in /admin, or skip the review on your own computer:

```bash
pnpm pro:approve 0803 123 4567   # local development only; written to the audit log
```

**Demo data:** `pnpm demo:data` adds 8 made-up, verified Pros around Ado-Ekiti (numbers
0700 000 0001 to 0008, so you can sign in as one), so the home page and Choose a Pro aren't
empty in a demo. `pnpm demo:data --remove` takes them out again. Local development only.

**Reviewing identity checks:** create a GADMO staff account (use a number that is not a Pro),
then sign in at http://localhost:3000/staff with the email and the password you typed, plus the
code sent to that phone. Staff can't use the customer and Pro sign-in.

```bash
pnpm admin:grant 0803 765 4321 you@example.com   # asks for a password (hidden); audit-logged
```

**A login code is refused?** The `pnpm dev:api` window explains every attempt with an `[OTP]`
line: whether the code was accepted, did not match the newest code, had expired or was already
used, or the number is locked after 5 wrong tries. If no `[OTP]` line appears when you press
Continue, the app is talking to a different API than the window you are watching: close every
other API window (`ss -ltnp | grep 4000` shows what holds port 4000) and start `pnpm dev:api` once.
If it says "no active code" seconds after the code was sent, your computer's clock is jumping (a
known WSL/Docker issue) and Redis expires codes early. Run `wsl --update` and `wsl --shutdown` in
PowerShell, or add `DEV_LOGIN_CODE=123456` to `apps/api/.env` to sign in with that code while you
develop. The API refuses to start with `DEV_LOGIN_CODE` outside development.

## Tests

```bash
pnpm lint && pnpm typecheck && pnpm build
pnpm test               # unit tests with coverage thresholds
pnpm test:integration   # API against real Postgres + Redis (resets the *_test database)
pnpm --filter @gadmo/web test:e2e     # browser tests on a phone-sized screen (needs a build)
pnpm --filter @gadmo/web check:size   # first-load JavaScript must stay under 200 KB per page
```

Locally, browser tests can use your installed Chrome: `PW_CHANNEL=chrome pnpm --filter @gadmo/web test:e2e`.

Every pull request must pass CI (lint, typecheck, unit, integration and authorization tests,
dependency audit, secret scan, CodeQL) before merging.

## API so far

| Method | Path                                   | Who                                               |
| ------ | -------------------------------------- | ------------------------------------------------- |
| GET    | `/health`                              | anyone                                            |
| POST   | `/v1/auth/otp/request`                 | anyone                                            |
| POST   | `/v1/auth/otp/verify`                  | anyone (sign up or log in)                        |
| POST   | `/v1/auth/refresh` · `/v1/auth/logout` | signed-in                                         |
| GET    | `/v1/auth/me`                          | signed-in (own account only)                      |
| GET    | `/v1/categories`                       | anyone                                            |
| GET    | `/v1/users/:id`                        | signed-in (public profile, never contact details) |
| POST   | `/v1/jobs`                             | customers                                         |
| GET    | `/v1/jobs` · `/v1/jobs/:id`            | the job's customer, its Pro, or staff             |

All POST/PUT/PATCH/DELETE requests must send the header `x-gadmo-client: web`.
