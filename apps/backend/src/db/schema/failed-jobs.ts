import { pgTable, uuid, text, integer, jsonb, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';

/**
 * One row per BullMQ job that exhausted all its configured retry attempts (only written once
 * `attemptsMade >= attempts`, not on every transient failure) — surfaces stuck jobs to a
 * human/admin per the "no silent failures" rule. queueName+jobId is unique; a manual retry gets
 * a new BullMQ job id so it doesn't collide with the original row. status distinguishes
 * needs-attention / retried / deliberately-ignored for an admin dashboard.
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