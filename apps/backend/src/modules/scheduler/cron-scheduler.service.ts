// src/modules/scheduler/cron-scheduler.service.ts
import { payoutCronQueue } from '@/queues/queues';
import { PayoutCronJob } from '@/queues/names';

interface ScheduleDef {
  id: string;
  jobName: string;
  pattern: string; // cron pattern
  data?: Record<string, unknown>;
}

const schedules: ScheduleDef[] = [
  // --- Production schedule: midnight, staggered a minute apart so the
  // five sweeps run in a predictable sequence rather than colliding.
  // See docs/bullmq-architecture.md's "Known tradeoff" note on the
  // resulting up-to-24h lag vs. the previous 5-15min polling cadence.
  { id: 'target-based-sweep', jobName: PayoutCronJob.TARGET_BASED_SWEEP, pattern: '0 0 * * *' },
  { id: 'recurring-sweep', jobName: PayoutCronJob.RECURRING_SWEEP, pattern: '1 0 * * *' },
  { id: 'expiry-sweep', jobName: PayoutCronJob.EXPIRY_SWEEP, pattern: '2 0 * * *' },
  { id: 'reconciliation-frequent', jobName: PayoutCronJob.RECONCILIATION, pattern: '3 0 * * *', data: { hoursBack: 1 } },
  { id: 'reconciliation-daily', jobName: PayoutCronJob.RECONCILIATION, pattern: '4 0 * * *', data: { hoursBack: 24 } },
];

export class CronSchedulerService {
  static async registerAll() {
    for (const s of schedules) {
      await payoutCronQueue.upsertJobScheduler(
        s.id,
        { pattern: s.pattern, tz: 'Africa/Lagos' },
        { name: s.jobName, data: s.data ?? {} }
      );
    }
  }
}