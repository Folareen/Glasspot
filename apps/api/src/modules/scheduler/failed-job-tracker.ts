// src/modules/reliability/failed-job-tracker.ts
import { QueueEvents, Queue } from 'bullmq';
import { db, failedJobs } from '@glasspot/db';
import { eq } from 'drizzle-orm';

export class FailedJobTracker {
  static attach(queueName: string, connection: any) {
    const events = new QueueEvents(queueName, { connection });

    events.on('failed', async ({ jobId, failedReason }) => {
      // Only persist once attempts are exhausted — BullMQ retries automatically before this.
      const queue = new Queue(queueName, { connection });
      const job = await queue.getJob(jobId);
      if (!job) return;

      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (!exhausted) return;

      await db.insert(failedJobs).values({
        queueName,
        jobName: job.name,
        jobId: job.id!,
        data: job.data,
        failedReason,
        attemptsMade: job.attemptsMade,
      });
    });

    return events;
  }

  /** Re-enqueue a specific failed job (e.g. from an admin endpoint) */
    static async retry(failedJobRowId: string, connection: any) {
        const [row] = await db.select().from(failedJobs).where(eq(failedJobs.id, failedJobRowId));
        if (!row || row.status !== 'pending') return null;

        const queue = new Queue(row.queueName, { connection });
        const job = await queue.add(row.jobName, row.data, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
        });

        await db
            .update(failedJobs)
            .set({ status: 'retried', resolvedAt: new Date() })
            .where(eq(failedJobs.id, row.id));

        return job;
    }
}