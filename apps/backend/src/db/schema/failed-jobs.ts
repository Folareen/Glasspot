import { pgTable, uuid, text, integer, jsonb, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';

/**
 * One row per BullMQ job that exhausted all its configured `attempts`.
 * We deliberately do NOT insert on every failed attempt — the `failed`
 * QueueEvents listener checks `job.attemptsMade >= job.opts.attempts`
 * before writing here, since BullMQ already retries transient failures on
 * its own. A row here means "BullMQ has given up and a human/admin needs
 * to look at this," matching the "no silent failures" rule for money
 * movement (see recurring_payout_configs.ts).
 *
 * queueName + jobId is unique because a job could theoretically emit
 * `failed` more than once in edge cases (e.g. a manual retry created via
 * `FailedJobTracker.retry` re-uses a new BullMQ job id, so this does not
 * collide with the original row — the original stays `resolved: true`
 * as an audit trail, and the retry gets its own row only if it fails too).
 *
 * status distinguishes "still needs attention" from "someone retried it"
 * from "someone looked and decided not to retry" — a plain boolean
 * couldn't tell those apart, which matters for an admin dashboard/list.
 */
export const failedJobStatusEnum = pgEnum('failed_job_status', [
  'pending', // exhausted retries, awaiting action
  'retried', // manually re-enqueued via FailedJobTracker.retry
  'ignored', // reviewed, deliberately not retried (e.g. duplicate/stale)
]);

export const failedJobs = pgTable(
  'failed_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queueName: text('queue_name').notNull(),
    jobName: text('job_name').notNull(),
    jobId: text('job_id').notNull(),
    data: jsonb('data').notNull(),
    failedReason: text('failed_reason').notNull(),
    attemptsMade: integer('attempts_made').notNull(),
    status: failedJobStatusEnum('status').notNull().default('pending'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    queueNameJobIdUnique: unique('failed_jobs_queue_name_job_id_key').on(table.queueName, table.jobId),
  })
);

export type FailedJob = typeof failedJobs.$inferSelect;
export type NewFailedJob = typeof failedJobs.$inferInsert;