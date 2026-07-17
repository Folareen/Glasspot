# Glasspot backend

Fastify + TypeScript API, backed by PostgreSQL (Drizzle ORM) and Redis (BullMQ). See the root
[README.md](../../README.md) for the system-wide picture and [CLAUDE.md](../../CLAUDE.md) for the
full docs index — in particular, read
[docs/system-rules.md](../../docs/system-rules.md) before touching anything involving
contributions, payouts, refunds, or the ledger, and
[docs/backend-rules.md](../../docs/backend-rules.md) before writing or reviewing backend code.

## Two processes, one codebase

This backend runs as **two separate Node processes** sharing one Postgres database and one Redis
instance — not two separate deployments of the same server, but genuinely different entry points
with different jobs:

| Process | Entry point | Responsibility |
|---|---|---|
| **API** | `src/server.ts` (via `buildApp()` in `src/app.ts`) | Serves HTTP requests, enqueues BullMQ jobs, registers cron schedules on boot. Never processes a job or calls Nomba's transfer endpoint itself. |
| **Worker** | `src/workers/worker.ts` | Dequeues and executes cron sweeps and transfer jobs — the only process that actually calls Nomba's `/transfer` endpoint. Scales/restarts independently of the API. |

Why split: a slow or failing Nomba call, or a burst of scheduled payouts, must never take down
request handling, and worker concurrency needs to be tunable separately from API traffic. Full
queue/job/retry design: [docs/bullmq-architecture.md](../../docs/bullmq-architecture.md).

## Request lifecycle

`app.ts`'s `buildApp()` wires, in order: shared Zod schemas (one `addSchema` call per module),
`@fastify/jwt` (decorates `server.authenticate`/`server.optionalAuthenticate`), `@fastify/rate-limit`
(Redis-backed, so limits hold across multiple API instances), CORS, the BullMQ plugin (queue
decorators + cron registration), and Bull Board (queue inspection UI). All routes are mounted under
`/api/v1`.

A typical mutating request:

1. Route's Fastify schema validates the body/params (AJV, via `$ref`'d Zod-derived JSON schemas —
   see `pots.schema.ts` for the pattern, including a documented AJV gotcha with `anyOf`/`oneOf`
   branches and `removeAdditional`).
2. `preHandler: [server.authenticate]` (or `optionalAuthenticate` for routes a public pot's
   anonymous visitor can also hit) verifies the JWT and checks `tokenVersion` against the DB —
   this is what makes logout/password-reset immediately revoke a still-unexpired access token,
   not just wait for it to time out (`src/lib/plugins/jwt.ts`).
3. Controller (`*.controller.ts`) extracts `userId`, calls the service, serializes the response —
   controllers hold no business logic themselves.
4. Service (`*.service.ts`) does the actual work: authorization checks (`assertIsAdmin`), Drizzle
   queries, and — for anything money-related — a call into `LedgerService`/the fee helpers rather
   than any ad hoc balance math.
5. Money fields cross the wire as naira decimal strings ("100.50"), converted to/from kobo
   integers at exactly one boundary (`nairaStringToKobo`/`koboToNairaString`,
   `src/lib/money.ts`) — see [docs/system-rules.md](../../docs/system-rules.md)'s money rule.

## Module map (`src/modules`)

| Module | Owns |
|---|---|
| `auth` | Register/login/OTP verification, JWT issuance, `tokenVersion`-based revocation, password reset |
| `me` | Current-user profile, default refund account |
| `pots` | Pot lifecycle (draft → open → closed), all four payout modes' configs, contributions, members/invites, manual-payout/refund OTP gating, the target-based/recurring/scheduled/expiry sweep logic |
| `ledger` | Double-entry posting (`ledger.service.ts`), account creation (`accounts.service.ts`), reconciliation against Nomba (`reconciliation.service.ts`) |
| `banks` | Cached Nigerian bank list (backing `verifyAccountDetails`'s bank-code lookups) |
| `scheduler` | Cron registration, the transfer job queue, `failed_jobs` tracking/retry, the BullMQ↔service glue (`payout-cron-handlers.ts`) |

`src/integrations/nomba` is the only code that talks to Nomba's HTTP API directly — virtual account
creation, transfers, bank-account lookups, webhook signature verification/handling, and the
per-recipient Redis-backed transfer throttle. Nothing outside this directory constructs a Nomba
request by hand.

## Money & the ledger

The ledger (`ledger_entries`, append-only, double-entry) is the single source of truth for every
balance in the system — never a cache, never derived-and-stored anywhere else except the one
sanctioned `balances` read-cache table, which must be written in the same DB transaction as the
ledger entries that produced it. Every contribution and every payout/refund posts **four** ledger
legs, not two, to keep the platform's own fee cut separate from Nomba's real processing cost:
`pot`/`platform_float`, `platform_revenue`, `nomba_fee_expense`, `nomba_clearing`. The exact
arithmetic lives in `src/lib/fees.ts` (`inboundFeeLegs`/`outboundFeeLegs`) — never hardcode a fee
amount or rate anywhere else. Full invariants (idempotency, immutability, locking, at-least-once
delivery, no silent failures):
[docs/system-rules.md](../../docs/system-rules.md).

## Jobs, cron, and the Nomba integration

Four daily cron jobs (target-based sweep, recurring+scheduled sweep, expiry sweep, reconciliation)
run in the API process and enqueue work onto a separate `transfers` BullMQ queue; only the worker
process dequeues and actually calls Nomba. Failed jobs that exhaust retries land in a `failed_jobs`
table for manual `retry`/`ignore` via `/api/v1/failed-jobs`. Full detail — queue definitions,
priority/rate-limiting rules, the per-recipient throttle, failure classification
(`UnrecoverableError` vs. retryable), and the ambiguous-failure (network timeout) handling — is in
[docs/bullmq-architecture.md](../../docs/bullmq-architecture.md).

**Known gap:** inbound (contribution) reconciliation matching isn't implemented — outbound
(payout/refund) reconciliation against Nomba's transaction list is fully working, but the field
needed to correlate an *inbound* virtual-account funding row back to a local contribution is still
unconfirmed against Nomba's docs/sandbox. See
[docs/bullmq-architecture.md](../../docs/bullmq-architecture.md)'s open items for the specific
blocker and the fix once it's confirmed. Flagging this here rather than leaving it silently
missing — planned fix soon.

## Database

```bash
pnpm db:generate   # generate a migration from src/db/schema/
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse data with Drizzle Studio
```

### Flow for adding a new table

Ensure the docker container is running in the background for this.

- Create a new file in `src/db/schema/`
- Export it from `src/db/schema/index.ts`
- Run `pnpm db:generate` — this generates a migration file in the migrations folder
- Run `pnpm db:migrate` to apply it

## Testing

```bash
pnpm test
```

See [test/README.md](test/README.md) for what's covered, what isn't, and two mocking assumptions
worth knowing about before adding a test.
