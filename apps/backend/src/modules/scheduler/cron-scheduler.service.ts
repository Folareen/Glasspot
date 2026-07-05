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
  // --- Production schedule (midnight, staggered) — commented out while
  // testing the every-minute versions below. Re-enable these and delete
  // the "-debug" block before shipping.
  { id: 'target-based-sweep', jobName: PayoutCronJob.TARGET_BASED_SWEEP, pattern: '0 0 * * *' },
  { id: 'recurring-sweep', jobName: PayoutCronJob.RECURRING_SWEEP, pattern: '1 0 * * *' },
  { id: 'expiry-sweep', jobName: PayoutCronJob.EXPIRY_SWEEP, pattern: '2 0 * * *' },
  { id: 'reconciliation-frequent', jobName: PayoutCronJob.RECONCILIATION, pattern: '3 0 * * *', data: { hoursBack: 1 } },
  { id: 'reconciliation-daily', jobName: PayoutCronJob.RECONCILIATION, pattern: '4 0 * * *', data: { hoursBack: 24 } },

  // // --- TEMP: every-minute debug schedule, for local testing only ---
  // { id: 'target-based-sweep-debug', jobName: PayoutCronJob.TARGET_BASED_SWEEP, pattern: '*/1 * * * *' },
  // { id: 'recurring-sweep-debug', jobName: PayoutCronJob.RECURRING_SWEEP, pattern: '*/1 * * * *' },
  // { id: 'expiry-sweep-debug', jobName: PayoutCronJob.EXPIRY_SWEEP, pattern: '*/1 * * * *' },
  // { id: 'reconciliation-debug', jobName: PayoutCronJob.RECONCILIATION, pattern: '*/1 * * * *', data: { hoursBack: 1 } },
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