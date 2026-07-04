/**
 * ============================================================================
 * BullMQ Architecture — Glasspot Payout/Transfer Processing
 * ============================================================================
 *
 * TWO PROCESSES, ONE JOB
 * -----------------------
 * This system runs as two separate Node processes sharing one Redis instance:
 *
 *   1. API process (apps/api/src/server.ts)
 *      - Registers cron schedules on boot (via bullmqPlugin's onReady hook)
 *      - Enqueues transfer jobs (via TransferQueueService, or app.queues.*
 *        directly from admin routes)
 *      - NEVER processes jobs — it only schedules/enqueues
 *
 *   2. Worker process (apps/api/src/worker.ts)
 *      - Runs `start:worker` / `dev:worker` as its own deployable unit
 *        (separate container/service in production)
 *      - Actually executes cron sweeps and transfer calls to Nomba
 *      - Can be scaled/restarted independently of the API
 *
 * This split exists so a worker crash or slow Nomba call never takes down
 * the HTTP API, and so worker concurrency can be tuned separately from API
 * request handling.
 *
 *
 * QUEUES
 * ------
 * Two BullMQ queues, defined in queues/names.ts + queues/queues.ts:
 *
 *   payout-cron   — scheduled sweep jobs (no external rate limits, just DB work)
 *   transfers     — actual money movement via Nomba's /transfer endpoint
 *                   (rate-limited, since Nomba caps requests per subaccount)
 *
 * Queue instances (payoutCronQueue, transfersQueue) are created ONCE and
 * shared — Queue objects are safe to share a single Redis connection.
 * Worker instances are NOT shared — each Worker/QueueEvents gets its own
 * Redis connection (BullMQ requirement, since Workers use blocking Redis
 * commands that would stall each other on a shared connection).
 *
 *
 * FLOW 1: SCHEDULED SWEEPS (payout-cron queue)
 * ---------------------------------------------
 * All five cron jobs currently run once daily at midnight, staggered by a
 * minute each so they run in a predictable sequence rather than colliding:
 *
 *   00:00  target-based-sweep    → PayoutCronHandlers.checkTargetBasedPayouts()
 *   00:01  recurring-sweep       → PayoutCronHandlers.checkRecurringPayouts()
 *   00:02  expiry-sweep          → PayoutCronHandlers.sweepExpiredContributions()
 *   00:03  reconciliation-freq   → PayoutCronHandlers.runReconciliation(1)
 *   00:04  reconciliation-daily  → PayoutCronHandlers.runReconciliation(24)
 *
 * Registration: CronSchedulerService.registerAll() calls
 * payoutCronQueue.upsertJobScheduler(id, {pattern, tz}, {name, data}) for
 * each entry in the `schedules` array (cron-scheduler.service.ts).
 * upsertJobScheduler is idempotent — safe to call on every boot/deploy,
 * won't create duplicate repeatable jobs.
 *
 * Execution: worker.ts's payoutCronWorker has concurrency:1 (sweeps must
 * not overlap themselves) and dispatches by job.name via the `cronDispatch`
 * map to the matching PayoutCronHandlers method. PayoutCronHandlers itself
 * knows nothing about BullMQ — it's plain business logic, reusable from
 * one-off scripts too.
 *
 * Each sweep, when it finds work to do (e.g. a pot hit its targetDate),
 * enqueues a job onto the `transfers` queue rather than calling Nomba
 * directly — this is what funnels ALL money movement through the single
 * rate-limited transfers worker.
 *
 * ⚠ KNOWN TRADEOFF: collapsing these to midnight-only introduces up to a
 * 24h lag between a condition being met (targetDate reached, contribution
 * expired) and it actually firing. Was previously polling every 5–15 min.
 * Revisit if this lag becomes a problem for payout-sensitive users.
 *
 * ⚠ reconciliation-frequent (hoursBack:1) is now redundant/broken at daily
 * cadence — it only checks the 11pm–midnight window and misses 23 hours.
 * Either delete it or change hoursBack to 24 (making it a duplicate of
 * reconciliation-daily). Needs a decision — not yet resolved.
 *
 *
 * FLOW 2: TRANSFERS (transfers queue)
 * -------------------------------------
 * TransferQueueService.enqueuePayout() / enqueueRefund() add jobs with:
 *   - priority: 1 for payouts, 10 for refunds (lower number = higher
 *     priority in BullMQ) — refunds are deliberately deprioritized behind
 *     payouts on the SAME queue, rather than using two separate queues.
 *     This is enough because priority is a per-job property, so the queue
 *     itself doesn't need splitting to get "payouts jump the line."
 *   - attempts: 5, exponential backoff starting at 5s
 *   - removeOnFail: false — kept around so FailedJobTracker can inspect
 *     them after all attempts are exhausted (see Flow 3)
 *
 * worker.ts's transfersWorker processes these with:
 *   - concurrency: 5
 *   - limiter: { max: TRANSFER_RATE_LIMIT_MAX, duration: ...MS } — this is
 *     the GLOBAL rate limit against Nomba's /transfer endpoint, applied
 *     across ALL jobs this worker processes (payouts + refunds combined,
 *     since they hit the same subaccount/endpoint).
 *     ⚠ NOMBA_TRANSFER_RATE_LIMIT_MAX/DURATION_MS env vars are currently
 *     PLACEHOLDER values — need Nomba's actual documented rate limit
 *     before going live, set with headroom below their stated ceiling.
 *
 * The handler builds a TransferParams object for nomba.transferToBankAccount():
 *   accountNumber  ← destinationAccount
 *   accountName    ← must be resolved separately (NOT YET WIRED — open item,
 *                    see below)
 *   bankCode       ← destinationBank
 *   amount         ← Number(amountKobo) — ⚠ UNCONFIRMED whether Nomba's
 *                    /transfer expects kobo or Naira; if Naira, this needs
 *                    /100 before sending, or a 100x overpayment will occur.
 *                    MUST verify against Nomba docs before production use.
 *   merchantTxRef  ← reference/idempotency key, prevents double-send on retry
 *   senderName     ← platform's own sender identity (currently hardcoded
 *                    PLATFORM_SENDER_NAME constant)
 *
 * ⚠ OPEN ITEM: accountName is required by Nomba's TransferParams but isn't
 * currently stored on targetBasedPayoutConfigs or recurringPayoutConfigs,
 * and isn't resolved anywhere yet. Needs either: (a) a bank-account-name
 * resolution step (Nomba likely has a "resolve account" endpoint) called
 * before enqueueing, with the result stored on the payout config, or
 * (b) added as a column captured at payout-config creation time.
 *
 *
 * FLOW 3: FAILURE TRACKING (failed_jobs table + FailedJobTracker)
 * ------------------------------------------------------------------
 * FailedJobTracker.attach(queueName, connection) is called once per queue
 * in worker.ts, listening to BullMQ's QueueEvents 'failed' event.
 *
 * IMPORTANT: this does NOT fire on every failed attempt — BullMQ already
 * retries transient failures on its own (per the `attempts`/`backoff`
 * config above). The listener checks job.attemptsMade >= job.opts.attempts
 * before writing anything, so a row in failed_jobs specifically means
 * "BullMQ has exhausted all retries — this needs human attention."
 * This matches the "no silent failures" rule from the recurring-payout-
 * configs schema doc comment.
 *
 * failed_jobs.status is one of:
 *   pending   — exhausted retries, awaiting action (default)
 *   retried   — an admin/operator called FailedJobTracker.retry(), which
 *               re-enqueues a NEW BullMQ job and marks the OLD row resolved
 *               (audit trail preserved — doesn't overwrite/delete)
 *   ignored   — reviewed, deliberately not retried (e.g. stale/duplicate)
 *
 * A (queueName, jobId) unique constraint + onConflictDoNothing guards
 * against double-inserting if a job somehow emits 'failed' more than once
 * after exhausting attempts.
 *
 * ⚠ OPEN ITEM: recurringPayoutConfigs' schema doc says low-balance failures
 * should "fail and wait," not blind-retry — but the current transfersWorker
 * config applies the same 5-attempt exponential backoff to ALL failure
 * causes (Nomba 5xx, network blip, AND insufficient balance) indistinctly.
 * Needs either: attempts:1 for recurring-payout transfer jobs specifically,
 * or a custom error type ("insufficient balance, do not retry") that a
 * custom backoff strategy can special-case.
 *
 * There's currently no admin UI/route wired to actually call
 * FailedJobTracker.retry()/.ignore() — only the service methods exist.
 *
 *
 * FASTIFY WIRING
 * ---------------
 * apps/api/src/lib/plugins/bullmq.ts (registered in app.ts):
 *   - Decorates app.queues.{payoutCron,transfers} so routes can enqueue
 *     jobs (e.g. an admin "trigger payout now" endpoint) without importing
 *     the queue singletons directly.
 *   - onReady hook calls CronSchedulerService.registerAll() — this is
 *     where the midnight schedules actually get registered with Redis on
 *     every app boot.
 *   - onClose hook closes both queues gracefully.
 *   ⚠ onClose only fires if something calls app.close() — if the deploy
 *   environment sends raw SIGTERM without that, Redis connections drop
 *   ungracefully. Check server.ts has a SIGTERM/SIGINT handler that calls
 *   app.close() before exiting.
 *
 *
 * MONOREPO / TOOLING NOTES
 * -------------------------
 * - failed_jobs table lives in packages/db (schema/failed-jobs.ts),
 *   exported from schema/index.ts alongside all other tables — imported
 *   as `import { db, failedJobs } from '@glasspot/db'` (NAMED imports —
 *   there is no default export from @glasspot/db, a past bug came from
 *   using `import failedJobs from '@glasspot/db'` by mistake).
 * - ioredis is pinned to an EXACT version (5.10.1) via root package.json's
 *   pnpm.overrides, because bullmq declares its own ioredis dependency
 *   separately from apps/api's — without pinning, pnpm can install two
 *   physically different copies, and TypeScript then treats their Redis
 *   classes as structurally incompatible (a real error hit during setup).
 * - createRedisConnection() sets maxRetriesPerRequest: null — required by
 *   BullMQ because Workers use blocking Redis commands; ioredis's default
 *   retry cap breaks this.
 *
 * ============================================================================
 */