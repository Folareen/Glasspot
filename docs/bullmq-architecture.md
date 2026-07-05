# BullMQ Architecture — Glasspot Payout/Transfer Processing

## Two processes, one job

This system runs as two separate Node processes sharing one Redis instance:

1. **API process** (`apps/api/src/server.ts`)
   - Registers cron schedules on boot (via `bullmqPlugin`'s `onReady` hook)
   - Enqueues transfer jobs (via `TransferQueueService`, or `app.queues.*` directly from admin routes)
   - Never processes jobs — it only schedules/enqueues

2. **Worker process** (`apps/api/src/worker.ts`)
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

> ⚠️ **Open item:** `reconciliation-frequent` (`hoursBack: 1`) is now redundant/broken at daily cadence — it only checks the 11pm–midnight window and misses 23 hours. Either delete it or change `hoursBack` to `24` (making it a duplicate of `reconciliation-daily`). Needs a decision — not yet resolved.

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
        // ...targetAmountKobo / adminManualEnabled conditions
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
      amountKobo: /* resolved pot balance at fire time */,
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

  > ⚠️ `NOMBA_TRANSFER_RATE_LIMIT_MAX` / `NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS` env vars are currently **placeholder values** — need Nomba's actual documented rate limit before going live, set with headroom below their stated ceiling.

The handler builds a `TransferParams` object for `nomba.transferToBankAccount()`:

```typescript
const response = await nomba.transferToBankAccount({
  accountNumber: destinationAccount,
  accountName,                    // ⚠ not yet resolved anywhere — see Open Items
  bankCode: destinationBank,
  amount: Number(amountKobo),     // ⚠ unconfirmed kobo vs. Naira — see Open Items
  merchantTxRef,                  // idempotency key, prevents double-send on retry
  senderName: PLATFORM_SENDER_NAME,
  narration,
});
```

| Field | Source |
|---|---|
| `accountNumber` | `destinationAccount` |
| `accountName` | **Not yet wired** — must be resolved separately |
| `bankCode` | `destinationBank` |
| `amount` | `Number(amountKobo)` — safe cast, JS's safe-integer ceiling (~9×10¹⁵) comfortably covers realistic Naira amounts in kobo |
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

> ⚠️ **Open item:** `recurringPayoutConfigs`' schema doc says low-balance failures should "fail and wait," not blind-retry — but the current `transfersWorker` config applies the same 5-attempt exponential backoff to **all** failure causes (Nomba 5xx, network blip, *and* insufficient balance) indistinctly. Needs either `attempts: 1` for recurring-payout transfer jobs specifically, or a custom error type ("insufficient balance, do not retry") that a custom backoff strategy can special-case.

> ⚠️ There's currently no admin UI/route wired to actually call `FailedJobTracker.retry()` / `.ignore()` — only the service methods exist.

---

## Fastify wiring

`apps/api/src/lib/plugins/bullmq.ts` (registered in `app.ts`):

- Decorates `app.queues.{payoutCron,transfers}` so routes can enqueue jobs (e.g. an admin "trigger payout now" endpoint) without importing the queue singletons directly.
- `onReady` hook calls `CronSchedulerService.registerAll()` — this is where the midnight schedules actually get registered with Redis on every app boot.
- `onClose` hook closes both queues gracefully.

> ⚠️ `onClose` only fires if something calls `app.close()` — if the deploy environment sends raw `SIGTERM` without that, Redis connections drop ungracefully. Check `server.ts` has a `SIGTERM`/`SIGINT` handler that calls `app.close()` before exiting.

---

## Monorepo / tooling notes

- `failed_jobs` table lives in `packages/db` (`schema/failed-jobs.ts`), exported from `schema/index.ts` alongside all other tables — imported as `import { db, failedJobs } from '@glasspot/db'` (**named** imports — there is no default export from `@glasspot/db`; a past bug came from using `import failedJobs from '@glasspot/db'` by mistake).
- `ioredis` is pinned to an **exact** version (`5.10.1`) via root `package.json`'s `pnpm.overrides`, because `bullmq` declares its own `ioredis` dependency separately from `apps/api`'s — without pinning, pnpm can install two physically different copies, and TypeScript then treats their `Redis` classes as structurally incompatible (a real error hit during setup).
- `createRedisConnection()` sets `maxRetriesPerRequest: null` — required by BullMQ because Workers use blocking Redis commands; ioredis's default retry cap breaks this.

---

## Open items (not yet resolved)

- [ ] Resolve `accountName` for transfer payloads — either a bank-account-name resolution step (Nomba likely has a "resolve account" endpoint) called before enqueueing, or a column captured at payout-config creation time.
- [ ] Confirm with Nomba docs whether `TransferParams.amount` expects kobo or Naira — if Naira, `amountKobo` needs `/100` before sending, or a 100x overpayment will occur.
- [ ] Decide fate of `reconciliation-frequent` now that everything runs daily — delete it, or change `hoursBack` to `24`.
- [ ] Differentiate "insufficient balance, don't retry" from transient Nomba/network failures in the transfers worker's error handling.
- [ ] Get Nomba's actual `/transfer` rate limit and replace the placeholder `NOMBA_TRANSFER_RATE_LIMIT_MAX` / `_DURATION_MS` values.
- [ ] Build admin routes for `FailedJobTracker.retry()` / `.ignore()` — service methods exist, nothing calls them yet.
- [ ] Confirm `server.ts` has a `SIGTERM`/`SIGINT` handler calling `app.close()` for graceful Redis shutdown.