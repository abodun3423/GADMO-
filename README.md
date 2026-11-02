# GADMO

**The Right Skills. Within Reach.** A lightweight marketplace (PWA) connecting people in Nigeria with
verified, nearby skilled professionals.

Product requirements: [GADMO PRD v1.0](https://claude.ai/artifact/N4HEkdBtJKrYrZwNHHVkAV) · Security: [SECURITY.md](SECURITY.md)

## Repository layout

| Path              | What it is                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS API, Drizzle ORM, PostgreSQL, Redis                                                      |
| `packages/shared` | Rules shared by API and web app: phone numbers, contact masking, money in kobo, request schemas |
| `apps/web`        | Next.js PWA (next pull request)                                                                 |

## Run it locally

Requirements: Node 22+, pnpm 10, and Docker (or your own Postgres 16 + Redis 7).

```bash
pnpm install
docker compose up -d            # Postgres + PostGIS and Redis on localhost only
cp .env.example apps/api/.env   # then fill in the secrets (openssl rand -base64 48)
pnpm --filter @gadmo/api db:migrate
pnpm --filter @gadmo/api db:seed
pnpm --filter @gadmo/api dev    # http://localhost:4000/health
```

In development, login codes are printed in the API console instead of being sent by SMS.

## Tests

```bash
pnpm lint && pnpm typecheck && pnpm build
pnpm test               # unit tests with coverage thresholds
pnpm test:integration   # API against real Postgres + Redis (resets the *_test database)
```

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
