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

Worker instances are **not** shared — each `Worker`/`QueueEvents` gets its own Redis connection (a BullMQ requirement, since Workers use blocking Redis commands that would stall each other on a shared connection).

---

## Flow 1: Scheduled sweeps (`payout-cron` queue)

All five cron jobs currently run once daily at midnight, staggered by a minute each so they run in a predictable sequence rather than colliding:

| Time | Job | Handler |
|---|---|---|
| 00:00 | `target-based-sweep` | `PayoutCronHandlers.checkTargetBasedPayouts()` |
| 00:01 | `recurring-sweep` | `PayoutCronHandlers.checkRecurringPayouts()` |
| 00:02 | `expiry-sweep` | `PayoutCronHandlers.sweepExpiredContributions()` |
| 00:03 | `reconciliation-frequent` | `PayoutCronHandlers.runReconciliation(1)` |
| 00:04 | `reconciliation-daily` | `PayoutCronHandlers.runReconciliation(24)` |

**Registration:** `CronSchedulerService.registerAll()` calls `payoutCronQueue.upsertJobScheduler(id, {pattern, tz}, {name, data})` for each entry in the `schedules` array (`cron-scheduler.service.ts`). `upsertJobScheduler` is idempotent — safe to call on every boot/deploy, won't create duplicate repeatable jobs.

**Execution:** `worker.ts`'s `payoutCronWorker` has `concurrency: 1` (sweeps must not overlap themselves) and dispatches by `job.name` via the `cronDispatch` map to the matching `PayoutCronHandlers` method. `PayoutCronHandlers` itself knows nothing about BullMQ — it's plain business logic, reusable from one-off scripts too.

> ⚠️ **Known tradeoff:** collapsing these to midnight-only introduces up to a 24h lag between a condition being met (targetDate reached, contribution expired) and it actually firing. Previously polling every 5–15 min. Revisit if this lag becomes a problem for payout-sensitive users.

> ⚠️ **Open item:** `reconciliation-frequent` (`hoursBack: 1`) is still redundant/broken at daily cadence — it only checks the 11pm–midnight window and misses 23 hours. Either delete it or change `hoursBack` to `24` (making it a duplicate of `reconciliation-daily`). Needs a decision — not yet resolved.

---

## Flow 2: Enqueueing a transfer (sweep → `transfers` queue)

Each sweep handler, when it finds work to do, does **not** call Nomba directly — it calls `TransferQueueService.enqueuePayout()` / `.enqueueRefund()`, which pushes a job onto the `transfers` queue. This is what funnels **all** money movement through the single rate-limited transfers worker, regardless of which sweep triggered it.

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

`TransferQueueService`:

```typescript
export class TransferQueueService {
  static async enqueuePayout(payload: TransferPayload) {
    return transfersQueue.add(TransferJob.PAYOUT, payload, {
      priority: TransferPriority.PAYOUT,   // 1
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  }

  static async enqueueRefund(payload: TransferPayload) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      priority: TransferPriority.REFUND,   // 10
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  }
}
```

- `priority: 1` for payouts, `10` for refunds (**lower number = higher priority** in BullMQ) — refunds are deliberately deprioritized behind payouts on the **same** queue, rather than using two separate queues. This works because priority is a per-job property, so the queue itself doesn't need splitting to get "payouts jump the line."
- `attempts: 5`, exponential backoff starting at 5s.
- `removeOnFail: false` — kept around so `FailedJobTracker` can inspect them after all attempts are exhausted (see Flow 4).

---

## Flow 3: Processing a transfer (`transfers` worker)

`worker.ts`'s `transfersWorker` processes jobs with:

- `concurrency: 5`
- `limiter: { max: TRANSFER_RATE_LIMIT_MAX, duration: ...MS }` — this is the **global** rate limit against Nomba's `/transfer` endpoint, applied across **all** jobs this worker processes (payouts + refunds combined, since they hit the same subaccount/endpoint).

  > ⚠️ `NOMBA_TRANSFER_RATE_LIMIT_MAX` / `NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS` are still **placeholder values**, read raw off `process.env` in `worker.ts` with hardcoded fallbacks (`?? 10` / `?? 1000`) — not even in `env.ts`'s validated schema or `.env.example` yet. Need Nomba's actual documented rate limit before going live, set with headroom below their stated ceiling.

The handler resolves the destination account's name via `nomba.lookupBankAccount()` before building the `TransferParams` object for `nomba.transferToBankAccount()`:

```typescript
const resolved = await nomba.lookupBankAccount(data.destinationAccount, data.destinationBank);
const response = await nomba.transferToBankAccount({
  accountNumber: destinationAccount,
  accountName: resolved.accountName,
  bankCode: destinationBank,
  amount: Number(amount) / 100, // Nomba expects Naira, not kobo — confirmed
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
| `amount` | `Number(amount) / 100` — ledger amount is kobo, Nomba's `/transfer` expects Naira |
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

> ⚠️ **Open item, resolved differently than originally proposed:** `recurringPayoutConfigs`' schema doc says low-balance failures should "fail and wait," not blind-retry. Rather than adding a distinct "insufficient balance, don't retry" error type, all transfer job types (`payout`, `pot_refund`, `contribution_refund` — see `transfer-queue.service.ts`) were switched to `attempts: 1` across the board (`worker.ts`: `// attempts:1 → straight to failed_jobs, no auto-retry`). This does stop blind-retrying insufficient-balance failures, but it also removes retries for genuinely transient failures (a Nomba 5xx or network blip now goes straight to `failed_jobs` too, same as before requiring a human to hit `FailedJobTracker.retry()`). Revisit if transient-failure volume in `failed_jobs` turns out to be high enough that it's worth distinguishing causes again.

> ⚠️ There's currently no admin UI/route wired to actually call `FailedJobTracker.retry()` / `.ignore()` — only the service methods exist.

---

## Fastify wiring

`apps/backend/src/lib/plugins/bullmq.ts` (registered in `app.ts`):

- Decorates `app.queues.{payoutCron,transfers}` so routes can enqueue jobs (e.g. an admin "trigger payout now" endpoint) without importing the queue singletons directly.
- `onReady` hook calls `CronSchedulerService.registerAll()` — this is where the midnight schedules actually get registered with Redis on every app boot.
- `onClose` hook closes both queues gracefully.

> ⚠️ **Still open:** `onClose` only fires if something calls `app.close()`. `server.ts` (the HTTP API process) has no `SIGTERM`/`SIGINT` handling at all today — it just calls `app.listen(...)` and exits ungracefully on a raw signal. The `SIGTERM`/`SIGINT` handling that does exist (`worker.ts`'s `shutdown()`) is in the separate worker process and only closes BullMQ workers/`QueueEvents` — there's no Fastify `app` in that file to close. The API process itself still needs its own signal handler calling `app.close()`.

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

Still open:

- [ ] Decide fate of `reconciliation-frequent` now that everything runs daily — still registered with `hoursBack: 1`, still redundant with `reconciliation-daily`. Delete it, or change `hoursBack` to `24`.
- [ ] Get Nomba's actual `/transfer` rate limit and replace the placeholder `NOMBA_TRANSFER_RATE_LIMIT_MAX` / `_DURATION_MS` values — still hardcoded fallbacks in `worker.ts`, not even in `env.ts`'s validated schema yet.
- [ ] Build admin routes for `FailedJobTracker.retry()` / `.ignore()` — service methods exist, nothing calls them yet.
- [ ] Give `server.ts` (the API process) a `SIGTERM`/`SIGINT` handler calling `app.close()` — it currently has none; the worker process's signal handling is separate and doesn't cover the Fastify app.
- [ ] Revisit blanket `attempts: 1` on all transfer job types — this was the fix applied for "insufficient balance shouldn't blind-retry," but it also removes retries for transient Nomba/network failures, which now go straight to `failed_jobs` same as a real failure. Worth a distinct error type if transient-failure volume becomes noticeable.
