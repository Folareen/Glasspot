# Test suite notes

## Running

```bash
pnpm test
```

This runs `pnpm db:test:up && pnpm db:test:migrate`, then node's native test runner against every
`test/**/*.test.ts` file: `node --import tsx --test --test-concurrency=1 --test-force-exit
--experimental-test-module-mocks`. `pnpm test:final` skips the `db:test:up` step (for CI where the
test DB container is already running).

Every test file truncates the whole `public` schema in a `beforeEach` (see `helpers/db.ts`) — tests
are **not** safe to run in parallel against the same database, which is why `--test-concurrency=1`
is non-negotiable here, not a style preference.

## What's covered

Auth:
- `auth-login.test.ts` — login/OTP request flow, generic-message parity between wrong-password and
  nonexistent-email (no user enumeration), unverified-user rejection
- `auth-token-revocation.test.ts` — `tokenVersion`-based access-token revocation on logout/password
  reset, refresh-token reuse detection, stale-`tokenVersion` rejection despite a valid signature

Pot lifecycle / authorization (no ledger/Nomba dependency):
- `pots-create.test.ts`, `pots-update.test.ts`, `pot-members.test.ts`

Ledger core:
- `ledger-service.test.ts` — balanced debit/credit posting, rejection of unbalanced entries,
  idempotency-by-reference (incl. a concurrent-race case), reversal
- `account-service.test.ts` — idempotent pot/system account creation (incl. concurrent first-use),
  correct `normalBalance` per account type, no ownerType collisions

Money movement / settlement:
- `contributions-confirm-funcding.test.ts` *(filename typo is real, not a doc error)* —
  exact/under/over payment funding, the 1% Nomba inbound fee vs. the flat floor, top-up after
  underpayment, an overpayment too small to cover the outbound refund fee, redelivered-webhook
  idempotency (post-funded and mid-underpaid)
- `pots-trigger-payout.test.ts` — OTP context-binding, real BullMQ enqueue with correct
  priority/amount, the `pendingOperation` lock rejecting a concurrent trigger, partial-amount
  payouts, Idempotency-Key replay not double-enqueueing, retry-after-downstream-failure not
  requiring a fresh OTP
- `pots-trigger-refund.test.ts` — contributor pro-rata fan-out math including the intentional
  truncation remainder and its `distributeExactly()` fix, the per-payment-split fallback for a
  contributor with no refund account on file, the `refundType='admin'` path

Cron-driven payout modes:
- `target-based-payout.test.ts` — amount/date eligibility (incl. a pure-amount config firing more
  than once), the enqueued amount netting out the ₦50 outbound fee rather than the raw balance,
  targetDate configs closing their pot on fire vs. pure-amount configs staying open
- `payout-scheduler.test.ts` — `recurring` due-config firing (and correctly skipping a config funded
  to the payout amount but not the outbound fee on top), `scheduled` legs: ordered (only the
  lowest-sequence unfired leg fires, later legs wait) and unordered fan-out
- `expiry.test.ts` — expired/underpaid contributions refunded and marked failed, the enqueued
  refund amount netting out the ₦50 outbound fee (never the raw payment amount) and a payment too
  small to cover that fee left unrefunded rather than sent at a loss, BullMQ `jobId` idempotency
  preventing a duplicate refund job on a re-run sweep, a payment already refunded not re-enqueued, a
  contribution funded by a race-adjacent webhook right before the sweep claims it left untouched

Reconciliation:
- `reconciliation.test.ts` — outbound (payout/refund) matching against Nomba's reported amount,
  genuine amount mismatches surfacing correctly, a payout Nomba has no record of reported
  `missing_on_nomba` rather than silently passing. **Inbound (contribution) matching is not covered
  here because it isn't implemented yet** — see the gap below.

Misc:
- `health.test.ts` — `GET /health` smoke test

## Two assumptions worth double-checking

1. `helpers/mocks.ts` mocks `nomba`'s methods directly on the singleton (works regardless of import
   site), and mocks `generateOtpCode`/`sendMail` via `import * as` on their modules — only valid if
   those compile to CommonJS. On native ESM, swap for node:test's `mock.module(...)`.
2. `helpers/queue.ts` inspects/drains the *real* `transfersQueue`/`payoutCronQueue`. Tests never run
   a worker, so a job just sits `waiting`, which is what lets these tests assert on enqueue behavior
   without a live worker or a real Nomba transfer call.

## Known gap, not a test-coverage problem

Inbound (contribution) reconciliation matching is unimplemented, not just untested — Nomba's
`GET /v1/transactions/accounts` list endpoint's actual correlating field for a virtual-account
funding row is still unconfirmed against Nomba's docs/sandbox. See
[docs/bullmq-architecture.md](../../../docs/bullmq-architecture.md)'s open items for the specific
field-mapping gap and the fix once it's confirmed. **This is a real, currently-open reconciliation
blind spot for inbound contributions — flagging it here so it isn't mistaken for something this
test suite already covers.**

## Still not covered

- `NombaWebhooksService.handle` (`integrations/nomba/nomba-webhooks.service.ts`) — no dedicated test
  file for the webhook handler itself; funding/settlement behavior is exercised indirectly through
  `contributions-confirm-funcding.test.ts` calling `confirmFunding`/`reverseFunding` directly rather
  than through the HTTP webhook route.
- `close()`'s zero-balance/race check, `activate()`, `contributeHandler` end-to-end over HTTP — the
  underlying services are covered indirectly by other tests, but there's no test hitting these
  routes directly.
