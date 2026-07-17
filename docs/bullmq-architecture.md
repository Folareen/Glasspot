# BullMQ Architecture — Glasspot Payout/Transfer Processing

## Two processes, one job

This system runs as two separate Node processes sharing one Redis instance:

1. **API process** (`apps/backend/src/server.ts`)
   - Registers cron schedules on boot (via `bullmqPlugin`'s `onReady` hook)
   - Enqueues transfer jobs (via `TransferQueueService`, or `app.queues.*` directly from admin routes)
   - Never processes jobs — it only schedules/enqueues

2. **Worker process** (`apps/backend/src/workers/worker.ts`)
   - Runs `start:worker` / `dev:worker` as its own deployable unit (separate container/service in production)
   - Actually executes cron sweeps and transfer calls to Nomba
   - Can be scaled/restarted independently of the API

This split exists so a worker crash or slow Nomba call never takes down the HTTP API, and so worker concurrency can be tuned separately from API request handling.

---

## Queues

Two BullMQ queues, defined in `queues/names.ts` + `queues/queues.ts`:

| Queue | Purpose |
|---|---|
| `payout-cron` | Scheduled sweep jobs (no external rate limits, just DB work) |
| `transfers` | Actual money movement via Nomba's `/transfer` endpoint (rate-limited, since Nomba caps requests per subaccount) |

Queue instances (`payoutCronQueue`, `transfersQueue`) are created **once** and shared — `Queue` objects are safe to share a single Redis connection.

Worker instances are **not** shared — each `Worker`/`QueueEvents` gets its own Redis connection via `createRedisConnection()` (`config/redis.ts`), a BullMQ requirement since Workers use blocking Redis commands that would stall each other on a shared connection. `worker.ts` creates four dedicated connections (cron worker, transfers worker, cron `QueueEvents`, transfer `QueueEvents`) and closes all of them in `shutdown()`. `FailedJobTracker.attach()` also creates one `Queue` instance per call and reuses it across every `'failed'` event on that queue, rather than constructing a fresh one per event.

---

## Flow 1: Scheduled sweeps (`payout-cron` queue)

Four cron jobs currently run once daily at midnight, staggered by a minute each so they run in a predictable sequence rather than colliding:

| Time | Job | Handler |
|---|---|---|
| 00:00 | `target-based-sweep` | `PayoutCronHandlers.checkTargetBasedPayouts()` |
| 00:01 | `recurring-sweep` | `PayoutCronHandlers.checkRecurringPayouts()` — also fires due `scheduled`-mode legs, see below |
| 00:02 | `expiry-sweep` | `PayoutCronHandlers.sweepExpiredContributions()` |
| 00:04 | `reconciliation-daily` | `PayoutCronHandlers.runReconciliation(24)` |

`checkRecurringPayouts()` covers **two** payout modes in one handler, not just `recurring`: it calls both `PayoutSchedulerService.fireDueRecurringPayouts()` and `PayoutSchedulerService.fireDueScheduledLegs()` (`payout-cron-handlers.ts`). There's no separate `scheduled-sweep` cron entry — `scheduled`-mode pots ride along on the `recurring-sweep` job.

**Registration:** `CronSchedulerService.registerAll()` calls `payoutCronQueue.upsertJobScheduler(id, {pattern, tz}, {name, data})` for each entry in the `schedules` array (`cron-scheduler.service.ts`). `upsertJobScheduler` is idempotent — safe to call on every boot/deploy, won't create duplicate repeatable jobs. It also calls `payoutCronQueue.removeJobScheduler(id)` for every id in `removedScheduleIds` (currently just `'reconciliation-frequent'`) on every boot — `upsertJobScheduler` only adds/updates, it never prunes a schedule that was removed from the `schedules` array, so a retired id has to be explicitly torn down this way or it keeps firing forever in Redis.

**Execution:** `worker.ts`'s `payoutCronWorker` has `concurrency: 1` (sweeps must not overlap themselves) and dispatches by `job.name` via the `cronDispatch` map to the matching `PayoutCronHandlers` method. `PayoutCronHandlers` itself knows nothing about BullMQ — it's plain business logic, reusable from one-off scripts too.

> ⚠️ **Known tradeoff:** collapsing these to midnight-only introduces up to a 24h lag between a condition being met (targetDate reached, contribution expired) and it actually firing. Previously polling every 5–15 min. Revisit if this lag becomes a problem for payout-sensitive users.

---

## Flow 2: Enqueueing a transfer (sweep → `transfers` queue)

Each sweep handler, when it finds work to do, does **not** call Nomba directly — it calls `TransferQueueService.enqueuePayout()` / `.enqueuePotRefund()` / `.enqueueContributionRefund()`, which pushes a job onto the `transfers` queue. This is what funnels **all** money movement through the single rate-limited transfers worker, regardless of which sweep triggered it. Three job kinds, not two — `pot_refund` (ledger-recognized, e.g. `refundType='admin'` or a contributors fan-out leg) and `contribution_refund` (refunding an inbound payment that never touched the ledger, e.g. an expired/underfunded contribution) are handled distinctly because only the former needs the ledger-transaction-posting step in the worker.

Example — inside `PayoutCronHandlers.checkTargetBasedPayouts()`:

```typescript
async checkTargetBasedPayouts() {
  const dueConfigs = await db.query.targetBasedPayoutConfigs.findMany({
    where: and(
      eq(targetBasedPayoutConfigs.fired, false),
      or(
        lte(targetBasedPayoutConfigs.targetDate, new Date()),
        // ...targetAmount condition
      )
    ),
  });

  for (const config of dueConfigs) {
    // Mark fired + write an outbox-style record in the SAME db transaction
    // as the enqueue decision, so a crash between "fire" and "enqueue"
    // can't double-pay or silently drop the payout.
    await db.transaction(async (tx) => {
      await tx
        .update(targetBasedPayoutConfigs)
        .set({ fired: true, firedAt: new Date() })
        .where(eq(targetBasedPayoutConfigs.id, config.id));
    });

    await TransferQueueService.enqueuePayout({
      potId: config.potId,
      destinationAccount: config.destinationAccount,
      destinationBank: config.destinationBank,
      accountName: /* resolved account holder name — see Open Item below */,
      amount: /* resolved pot balance at fire time */,
      merchantTxRef: `payout-${config.id}-${config.firedAt?.getTime()}`,
    });
  }

  return { fired: dueConfigs.length, skipped: 0 };
}
```

The same pattern applies to `checkRecurringPayouts()` (one `enqueuePayout` call per due `recurringPayoutConfigs` row, advancing `nextRunAt` by `intervalDays` after a successful enqueue — not after a successful transfer, since the transfer itself is async and may retry) and to `sweepExpiredContributions()` (calls `TransferQueueService.enqueueRefund()` per contributor needing a refund on an expired, under-funded pot).

`TransferQueueService` (`transfer-queue.service.ts`):

```typescript
const TRANSFER_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
} as const;

export const TransferQueueService = {
  async enqueuePayout(payload) {
    return transfersQueue.add(TransferJob.PAYOUT, payload, {
      jobId: payload.reference,
      priority: TransferPriority.PAYOUT,   // 1
      ...TRANSFER_JOB_OPTS,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },

  async enqueuePotRefund(payload) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      jobId: payload.reference,
      priority: TransferPriority.REFUND,   // 10
      ...TRANSFER_JOB_OPTS,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },

  async enqueueContributionRefund(payload) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      jobId: payload.reference,
      priority: TransferPriority.REFUND,
      ...TRANSFER_JOB_OPTS,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },
};
```

- `priority: 1` for payouts, `10` for both refund kinds (**lower number = higher priority** in BullMQ) — refunds are deliberately deprioritized behind payouts on the **same** queue, rather than using two separate queues. This works because priority is a per-job property, so the queue itself doesn't need splitting to get "payouts jump the line."
- `jobId: payload.reference` — every call site constructs `reference` as an already-unique idempotency key (e.g. `expiry.service.ts`'s `expiry_refund_<paymentId>`), so a duplicate enqueue with the same `jobId` is a BullMQ no-op rather than a second job. This is what makes a sweep safe to re-run before the previous run's jobs have finished.
- `attempts: 5`, exponential backoff starting at 5s — for genuinely transient failures (Nomba 5xx, network blip). A **deterministic** failure (insufficient balance, a confirmed Nomba rejection) instead throws BullMQ's `UnrecoverableError` from inside the worker's processor (see Flow 3/4 below), which skips all remaining attempts regardless of this config and goes straight to `failed_jobs` on the first try.
- `removeOnFail: false` — kept around so `FailedJobTracker` can inspect them after all attempts are exhausted (see Flow 4).

---

## Flow 3: Processing a transfer (`transfers` worker)

`worker.ts`'s `transfersWorker` processes jobs with:

- `concurrency: 5`
- `limiter: { max: TRANSFER_RATE_LIMIT_MAX, duration: ...MS }` — this is the **global** rate limit against Nomba's `/transfer` endpoint, applied across **all** jobs this worker processes (payouts + refunds combined, since they hit the same subaccount/endpoint).

  > ⚠️ `NOMBA_TRANSFER_RATE_LIMIT_MAX` / `NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS` are now in `env.ts`'s validated zod schema and `.env.example`, but the values themselves (`10` / `1000`) are still **placeholders**. Need Nomba's actual documented `/transfer` rate limit before going live, set with headroom below their stated ceiling.

- **Per-recipient throttle (resolved):** Nomba's dashboard shows a separate, narrower cap on `POST /v2/transfers/bank` — **5 transfers to the SAME recipient per minute** — independent of the global limiter above. A recurring payout config firing repeatedly to the same fixed destination, or several pots paying out to the same bank account within the same minute, can trip this even while comfortably under the global cap. `RedisTransferThrottle` (`src/integrations/nomba/transfer-throttle.ts`) tracks a sliding-window count per `destinationAccount:destinationBank`, atomically via a single Redis `EVAL` (`reserve()` — check-and-add in one script, so two jobs to the same recipient racing under `concurrency:5` can't both slip past the cap before either counts against it). The `transfersWorker` processor calls `reserve()` **before** dispatching to `processLedgerDisbursement`/`processContributionRefund` — if it returns false, the job is pushed back via `job.moveToDelayed()` + `throw new DelayedError()` (BullMQ's documented "this job was postponed, not failed" signal, so it does NOT count against `attempts:1` and does NOT emit `FailedJobTracker`'s `'failed'` event). The check happens this early specifically so a throttled job never reaches `processLedgerDisbursement`'s ledger-transaction-posting step — delaying afterward would make the resulting `DelayedError` propagate through that function's `catch` block as if a real Nomba call had failed, risking a wrongful reversal of a transaction that was never attempted.

The handler resolves the destination account's name via `nomba.lookupBankAccount()` before building the `TransferParams` object for `nomba.transferToBankAccount()`:

```typescript
const resolved = await nomba.lookupBankAccount(data.destinationAccount, data.destinationBank);
const response = await nomba.transferToBankAccount({
  accountNumber: destinationAccount,
  accountName: resolved.accountName,
  bankCode: destinationBank,
  amountNaira: Number(koboToNairaString(amount)), // Nomba expects Naira, not kobo — confirmed
  merchantTxRef,                  // idempotency key, prevents double-send on retry
  senderName: PLATFORM_SENDER_NAME,
  narration,
});
```

| Field | Source |
|---|---|
| `accountNumber` | `destinationAccount` |
| `accountName` | Resolved via `nomba.lookupBankAccount()` at send time |
| `bankCode` | `destinationBank` |
| `amountNaira` | `Number(koboToNairaString(amount))` — ledger amount is kobo, Nomba's `/transfer` expects Naira (see `docs/system-rules.md`'s money rule and `src/lib/money.ts`) |
| `merchantTxRef` | `reference`/idempotency key |
| `senderName` | Hardcoded `PLATFORM_SENDER_NAME` constant |

---

## Flow 4: Failure tracking (`failed_jobs` table + `FailedJobTracker`)

`FailedJobTracker.attach(queueName, connection)` is called once per queue in `worker.ts`, listening to BullMQ's `QueueEvents` `'failed'` event.

**Important:** this does **not** fire on every failed attempt — BullMQ already retries transient failures on its own (per the `attempts`/`backoff` config above). The listener checks `job.attemptsMade >= job.opts.attempts` before writing anything, so a row in `failed_jobs` specifically means *"BullMQ has exhausted all retries — this needs human attention."* This matches the "no silent failures" rule from the `recurring_payout_configs` schema doc comment.

`failed_jobs.status` is one of:

| Status | Meaning |
|---|---|
| `pending` | Exhausted retries, awaiting action (default) |
| `retried` | An admin/operator called `FailedJobTracker.retry()`, which re-enqueues a **new** BullMQ job and marks the **old** row resolved (audit trail preserved — doesn't overwrite/delete) |
| `ignored` | Reviewed, deliberately not retried (e.g. stale/duplicate) |

A `(queueName, jobId)` unique constraint + `onConflictDoNothing` guards against double-inserting if a job somehow emits `'failed'` more than once after exhausting attempts.

`recurringPayoutConfigs`' schema doc says low-balance failures should "fail and wait," not blind-retry. This is now handled with a distinct error type rather than the blanket `attempts: 1` this doc previously described: every transfer job gets `attempts: 5` with exponential backoff (genuinely transient Nomba 5xx/network failures get retried), but a deterministic failure — insufficient balance, or a confirmed Nomba rejection — makes the worker's processor throw BullMQ's `UnrecoverableError` instead of a plain `Error`, which skips all remaining attempts and goes straight to `failed_jobs` on the first try regardless of the `attempts` config. See `worker.ts`'s processor and `UnrecoverableError` usage.

`FailedJobTracker.ignore()` marks a row `ignored` (reviewed, deliberately not retried) with no BullMQ interaction. Both `retry()` and `ignore()` are wired to admin routes at `POST /api/v1/failed-jobs/:id/retry` and `POST /api/v1/failed-jobs/:id/ignore` (plus `GET /api/v1/failed-jobs` to list pending rows) — see `modules/scheduler/failed-jobs.route.ts`. Gated by the same narrow `BANKS_REFRESH_ALLOWED_USER_IDS` allowlist as `POST /banks/refresh`, since there's still no general staff/admin role in this codebase.

> ⚠️ **Still ambiguous-failure risk in the transfer worker's catch block:** `processLedgerDisbursement` now only reverses the ledger transaction when the thrown error is a `NombaApiError` with a non-zero HTTP status (Nomba actually responded and rejected the call — confirmed not executed). A `status: 0` (network error/timeout/DNS failure — no response at all) leaves the transaction `processing` and the lock held, deferring resolution to the payout webhook or reconciliation instead of guessing. This narrows, but doesn't eliminate, the "was it actually sent" ambiguity — there's still no dedicated "query this transaction's status by reference" call against Nomba's API to resolve it proactively; `fetchTransactions`/`reconcile` are date-range/bulk only.

---

## Fastify wiring

`apps/backend/src/lib/plugins/bullmq.ts` (registered in `app.ts`):

- Decorates `app.queues.{payoutCron,transfers}` so routes can enqueue jobs (e.g. an admin "trigger payout now" endpoint) without importing the queue singletons directly.
- `onReady` hook calls `CronSchedulerService.registerAll()` — this is where the midnight schedules actually get registered with Redis on every app boot.
- `onClose` hook closes both queues gracefully.

`server.ts` now has its own `SIGTERM`/`SIGINT` handler calling `app.close()`, which drains Fastify's own connections and cascades through `onClose` on every registered plugin (including `bullmqPlugin`'s) — no separate BullMQ cleanup needed in `server.ts` itself. This is distinct from `worker.ts`'s own `shutdown()` in the separate worker process, which closes BullMQ workers/`QueueEvents` directly since there's no Fastify `app` in that file.

---

## Monorepo / tooling notes

- `failed_jobs` table lives in `apps/backend/db` (`schema/failed-jobs.ts`), exported from `schema/index.ts` alongside all other tables — imported as `import { db, failedJobs } from '@/db'` (**named** imports — there is no default export from `@/db`; a past bug came from using `import failedJobs from '@/db'` by mistake).
- `ioredis` is pinned to an **exact** version (`5.10.1`) via root `package.json`'s `pnpm.overrides`, because `bullmq` declares its own `ioredis` dependency separately from `apps/backend`'s — without pinning, pnpm can install two physically different copies, and TypeScript then treats their `Redis` classes as structurally incompatible (a real error hit during setup).
- `createRedisConnection()` sets `maxRetriesPerRequest: null` — required by BullMQ because Workers use blocking Redis commands; ioredis's default retry cap breaks this.

---

## Open items

Resolved since this doc was first written:

- [x] `accountName` for transfer payloads — resolved via `nomba.lookupBankAccount()` at send time (`worker.ts`), and `verifyAccountDetails()` at save time for pot-configured destinations (`pots.service.ts`).
- [x] Kobo vs. Naira for `TransferParams.amount` — confirmed Naira; `amount` is divided by 100 before sending (`worker.ts`).
- [x] Shared Redis connection across Workers — `worker.ts` now gives `payoutCronWorker`, `transfersWorker`, and each `QueueEvents` its own connection via `createRedisConnection()`; `FailedJobTracker.attach()` reuses one `Queue` per queue instead of constructing a new one per failure event.
- [x] `postContributorsRefund` (refundType='contributors') now enqueues one `pot_refund` job per leg onto the shared `transfers` queue instead of calling Nomba/the ledger inline in the request handler — same rate limiting, `failed_jobs` tracking, and worker-side lock resolution as every other disbursement path. A new `isFanOutLeg` flag on the job payload (distinct from `contributorUserId`, which is metadata-only) tells the worker's `releaseLock` to decrement the shared pot-level lock rather than clear it outright — needed because an anonymous contributor's leg has no `contributorUserId` but is still one of N legs.
- [x] Get Nomba's actual `/transfer` rate limit and replace the placeholder `NOMBA_TRANSFER_RATE_LIMIT_MAX` / `_DURATION_MS` values — partially resolved: both are now in `env.ts`'s validated schema and `.env.example`, but the values themselves are still guessed defaults pending Nomba's documented ceiling.
- [x] Build admin routes for `FailedJobTracker.retry()` / `.ignore()` — `modules/scheduler/failed-jobs.route.ts` now exposes list/retry/ignore under `/api/v1/failed-jobs`, gated by the same allowlist pattern as `POST /banks/refresh`.
- [x] Blind-reversal-on-ambiguous-failure — `processLedgerDisbursement`'s catch block now only reverses the ledger transaction on a confirmed-not-executed `NombaApiError` (non-zero HTTP status); a `status: 0` network/timeout error leaves the transaction `processing` and the lock held for the webhook/reconciliation to resolve later, rather than guessing.
- [x] Nomba's per-recipient `/transfer` cap — confirmed via the Nomba dashboard's own rate-limit notice: 5 transfers to the SAME recipient per minute, separate from and narrower than the global `TRANSFER_RATE_LIMIT_MAX`/`_DURATION_MS` limiter. `RedisTransferThrottle` (`src/integrations/nomba/transfer-throttle.ts`) now enforces it per `destinationAccount:destinationBank` via an atomic Redis `EVAL`, delaying (not failing) a throttled job with `job.moveToDelayed()` + `DelayedError` before it ever reaches `processLedgerDisbursement` — see Flow 3 above.
- [x] `reconciliation-frequent` — removed entirely (`cron-scheduler.service.ts`'s `removedScheduleIds` tears down the leftover Redis-side scheduler on boot); only `reconciliation-daily` (`hoursBack: 24`) remains.
- [x] `server.ts` (the API process) `SIGTERM`/`SIGINT` handling — added, calls `app.close()`.
- [x] Blanket `attempts: 1` on all transfer job types — replaced with `attempts: 5` + exponential backoff for genuinely transient failures, and a distinct `UnrecoverableError` throw for deterministic failures (insufficient balance, confirmed Nomba rejection) that skips straight to `failed_jobs`. See Flow 4 above.

Still open:

- [ ] Nomba's actual GLOBAL `/transfer` rate limit — still a guessed default (`10`/`1000ms`) for `TRANSFER_RATE_LIMIT_MAX`/`_DURATION_MS`, validated/documented in `env.ts` and `.env.example` but not confirmed against Nomba's real ceiling. (The separate PER-RECIPIENT cap is resolved — see above.)
- [ ] No dedicated "get transaction status by reference" call exists against Nomba's API — only bulk/date-range `fetchTransactions`/`reconcile`. Would let the ambiguous-failure path (Flow 3/4 above) resolve proactively instead of waiting on the webhook/next reconciliation pass.
- [ ] **Inbound (contribution) reconciliation matching is unimplemented** — `reconciliation.service.ts`'s `findLocalByRef` matches Nomba transaction-list rows back to local `transactions.reference` by `merchantTxRef`, which correctly correlates outbound payouts/refunds (set by `worker.ts`'s own transfer calls) but is never set on inbound `payment_success`/`payment_reversal` events (see `nomba.types.ts`'s `WebhookTransactionData` doc comment) — those set `aliasAccountReference` instead, which the reconcile-list endpoint's own `Transaction` type doesn't yet declare a field for. **Fix once Nomba's real field is confirmed** (checking their `GET /v1/transactions/accounts` docs/sandbox): add the confirmed field to `nomba.types.ts`'s `Transaction` interface, add a `correlatingRef(tx)` accessor in `nomba.client.ts` that falls back from `merchantTxRef` to it, update `findLocalByRef` to match inbound contributions by it. Until then, `reconcile()` can only catch outbound drift — inbound contributions rely solely on the webhook + `contributions.service.ts`'s own funding logic, with no reconciliation safety net.
