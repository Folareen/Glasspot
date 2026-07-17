# Glasspot — Nomba 2026 Hackathon Project

Whenever more than one person puts money toward the same goal, that money usually lands in one person's account, and only that person decides when it moves and where. Glasspot fixes this: a group agrees on the payout rule before anyone contributes, and money only moves when that rule is met (a target amount, a date) or when a trusted member acts in the open, where every move is visible. Once contributions start, nobody can quietly change the rule or grab the money.

See [CLAUDE.md](CLAUDE.md) for the full docs index, and [docs/spec-mvp.md](docs/spec-mvp.md) for the product spec this build implements.

## Concepts

- **Pot** — a pooled-money goal. `private` (members only) or `public` (anyone can view/contribute). Starts as `draft` (fully editable), is activated to `open` (accepts contributions, payout rule now locked forever), and ends `closed` once its balance is zero.
- **Contribution** — each contribution gets its own one-time virtual account to pay into. Can be marked anonymous and can set its own refund destination.
- **Payout mode** — chosen once at pot creation, immutable after activation. MVP supports four:
  - `target_based` — pays out the full balance once, automatically, when a target amount and/or date is reached.
  - `manual` — an admin triggers payout at will, any number of times, gated by an email confirmation code. Destination is either fixed at creation or chosen per-trigger.
  - `recurring` — a fixed amount to one destination on a fixed interval, until the pot closes.
  - `scheduled` — a sequence of destinations, each with its own amount and date, either firing strictly in turn (`ordered`, ajo/esusu-style) or independently (installments).
- **Refund** — drains a pot to zero without a payout, either back to the admin or to each original contributor. Gated by the same email confirmation code as a manual payout trigger.
- **Fees** — Glasspot charges a flat ₦20 on every contribution and ₦50 on every payout/refund, always added on top so the pool amount the group agreed on is never shaved down. See the Fees section of [docs/spec-mvp.md](docs/spec-mvp.md) for exact math on full-balance payouts.

## Monorepo layout

- `apps/web` — Next.js (App Router, TypeScript, Tailwind CSS, no `src` dir)
- `apps/backend` — Fastify + TypeScript (API, worker, jobs)
- `apps/backend/src/db` — Drizzle ORM schema/client, targeting PostgreSQL

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs (virtual accounts, transfers, webhooks).

## Setup

```bash
cp apps/backend/.env.example apps/backend/.env
pnpm db:up
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/health
- Postgres: `localhost:5433` (see `apps/backend/.env` for credentials)
- Redis: `localhost:6389` (see `apps/backend/.env` for credentials)

Fill in `apps/backend/.env` with real values before anything Nomba- or email-related will work:

- `NOMBA_CLIENT_ID`, `NOMBA_CLIENT_SECRET`, `NOMBA_ACCOUNT_ID`, `NOMBA_SUBACCOUNT_ID`, `NOMBA_WEBHOOK_SECRET` — from your Nomba dashboard (sandbox for local dev).
- `BREVO_API_KEY` and `MAIL_FROM` — used to send OTP/confirmation emails; without a real key, emails will not send.
- `JWT_SECRET` / `REFRESH_TOKEN_SECRET` — replace the sample secrets before deploying anywhere shared.

## Database

```bash
pnpm db:generate   # generate a migration from apps/backend/src/db/schema/
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse data with Drizzle Studio
```

## Money & ledger invariants

Glasspot's backend treats the ledger as the single source of truth for all balances — double-entry, integer kobo amounts, immutable rows, idempotent writes. Read [docs/system-rules.md](docs/system-rules.md) in full before touching any code that involves contributions, payouts, refunds, or account balances.

## System architecture

Three moving pieces talk to each other over HTTP and Redis — no shared process, no shared memory:

```
┌─────────────┐        same-origin /api/*        ┌──────────────────────┐
│   Browser   │ ───────────────────────────────▶ │  Next.js (apps/web)  │
│             │ ◀─────────────────────────────── │  Route Handlers act  │
└─────────────┘      httpOnly session cookie      │  as a BFF proxy      │
                                                    └──────────┬───────────┘
                                                               │ Bearer JWT
                                                               ▼
                                                    ┌──────────────────────┐
                                                    │  Fastify API          │
                                                    │  (apps/backend)       │
                                                    │  server.ts             │
                                                    └────┬─────────────┬────┘
                                                         │             │
                                              enqueues   │             │ reads/writes
                                              jobs        ▼             ▼
                                                    ┌──────────┐  ┌──────────────┐
                                                    │  Redis    │  │  PostgreSQL   │
                                                    │  (BullMQ) │  │  (Drizzle)    │
                                                    └────┬──────┘  └──────────────┘
                                                         │ dequeues jobs
                                                         ▼
                                                    ┌──────────────────────┐
                                                    │  Worker process        │
                                                    │  (apps/backend/src/    │
                                                    │  workers/worker.ts)    │
                                                    │  → calls Nomba APIs    │
                                                    └──────────────────────┘
```

- **Browser never talks to the backend directly.** The frontend is a BFF (backend-for-frontend): the browser only calls same-origin `/api/*` routes on the Next.js server, which holds the JWT access/refresh token pair in httpOnly cookies (never exposed to client-side JS, never carried in a URL) and forwards each request to the real Fastify API with a `Bearer` header — transparently refreshing on a `401` and retrying once. See [apps/web's README](apps/web/README.md#auth--the-bff-proxy) for the full flow.
- **API process vs. worker process are two separate deployables sharing one Redis instance.** The API (`server.ts`) handles HTTP requests and *enqueues* work; it never calls Nomba directly for money movement and never processes a BullMQ job itself. The worker (`workers/worker.ts`) is the only process that calls Nomba's transfer API — this means a slow/failing Nomba call, or a burst of scheduled payouts, can't take down request handling, and worker concurrency scales independently of API traffic. See [docs/bullmq-architecture.md](docs/bullmq-architecture.md) for the full queue/cron/retry design.
- **The ledger (Postgres) is the single source of truth for money**, never a cache or a derived value held only in Redis or application memory — see [docs/system-rules.md](docs/system-rules.md).
- **Nomba is the actual money-mover.** The backend never moves money itself; every payout/refund is a `POST` to Nomba's transfer API, gated behind BullMQ's rate limiting and a per-recipient throttle (`RedisTransferThrottle`) since Nomba caps transfer requests per subaccount and per recipient. Nomba webhooks notify the backend of inbound funding/outbound settlement, but a webhook is never trusted as the sole source of truth — a reconciliation cron sweep re-polls Nomba's own transaction list to catch anything missed, delayed, or duplicated (see [docs/system-rules.md](docs/system-rules.md)'s "webhooks are a notification, not a source of truth" rule).

For a deeper dive into each side: [apps/backend/README.md](apps/backend/README.md) (modules, request lifecycle, queues, jobs) and [apps/web/README.md](apps/web/README.md) (route structure, BFF proxy, component/data conventions).