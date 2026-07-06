# Test suite notes

## Running

1. Point a real (disposable) Postgres at `DATABASE_URL`, migrated with your normal migration command:
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/glasspot_test`
2. Point a real (disposable) Redis at whatever `lib/plugins/bullmq.ts` reads (likely `REDIS_URL`).
3. Run with a TS loader, e.g.:
   `node --import tsx --test test/**/*.test.ts`
   (swap `tsx` for `ts-node/esm` or whatever loader this repo already uses — I haven't seen a
   `package.json`/`tsconfig.json` yet, so I don't know which is configured.)

Every test file truncates the whole `public` schema in a `beforeEach` (see `helpers/db.ts`) —
tests are not safe to run in parallel against the same database. If your test runner parallelizes
across files, either run with `--test-concurrency=1` or point each worker at its own DB.

## What's covered so far

Pot lifecycle / authorization (no ledger/Nomba dependency):
- `pots-create.test.ts`, `pots-update.test.ts`, `pot-members.test.ts`

Money movement / settlement (the priority):
- `ledger/ledger.service.test.ts` — balanced debit/credit posting, rejection of unbalanced
  entries, idempotency-by-reference (incl. a concurrent-race case), reversal
- `ledger/accounts.service.test.ts` — idempotent pot/system account creation, correct normalBalance
- `pots/contributions-confirm-funding.test.ts` — exact/under/over payment funding, top-up after
  underpayment, redelivered-webhook idempotency (post-funded and mid-underpaid), reversal
- `pots/pots-trigger-payout.test.ts` — OTP context-binding, real BullMQ enqueue with correct
  priority/amount, the pendingOperation lock rejecting a concurrent trigger, partial-amount
  payouts, Idempotency-Key replay not double-enqueueing
- `pots/pots-trigger-refund-fanout.test.ts` — contributor pro-rata fan-out math including the
  intentional truncation remainder, the per-payment-split fallback, and the `refundType='admin'` path

## Two assumptions worth double-checking

1. `helpers/mocks.ts` mocks `nomba`'s methods directly on the singleton (works regardless of
   import site), and mocks `generateOtpCode`/`sendMail` via `import * as` on their modules — only
   valid if those compile to CommonJS. On native ESM, swap for node:test's `mock.module(...)`.
2. `helpers/queue.ts` inspects/drains the *real* `transfersQueue`/`payoutCronQueue`. Tests never
   run a worker, so a job just sits `waiting`, which is what lets these tests assert on enqueue
   behavior without a live worker or a real Nomba transfer call.

## Still not covered

- `resolvePendingTransfer` (webhook-driven settlement completion) — needs
  `integrations/nomba/nomba-webhooks.service.ts` (`NombaWebhooksService.handle`), not seen yet.
- `close()`'s zero-balance/race check, `activate()`, `contributeHandler` end-to-end over HTTP —
  straightforward now that the ledger/Nomba pieces exist, just not written yet.
- `target_based`/`recurring`/`scheduled` payout modes, and the `PayoutSchedulerService`/
  `TargetBasedPayoutService` cron sweeps.