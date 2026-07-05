// src/worker.ts
import { Worker, QueueEvents } from 'bullmq';
import redisConnection from '@/config/redis';
import { QueueName, PayoutCronJob, TransferJob } from '@/queues/names';
import { PayoutCronHandlers } from '@/modules/scheduler/payout-cron-handlers';
import { FailedJobTracker } from '@/modules/scheduler/failed-job-tracker';
import { nomba } from '@/integrations/nomba'; // your existing Nomba client
import { TransferQueueService, PLATFORM_SENDER_NAME } from '@/modules/scheduler/transfer-queue.service';

const connection = redisConnection;
const handlers = new PayoutCronHandlers();

// --- Cron/sweep worker: dispatch job.name -> handler method ---
const cronDispatch: Record<string, (data: any) => Promise<unknown>> = {
  [PayoutCronJob.TARGET_BASED_SWEEP]: () => handlers.checkTargetBasedPayouts(),
  [PayoutCronJob.RECURRING_SWEEP]: () => handlers.checkRecurringPayouts(),
  [PayoutCronJob.EXPIRY_SWEEP]: () => handlers.sweepExpiredContributions(),
  [PayoutCronJob.RECONCILIATION]: (data) => handlers.runReconciliation(data?.hoursBack),
};

const payoutCronWorker = new Worker(
  QueueName.PAYOUT_CRON,
  async (job) => {
    const fn = cronDispatch[job.name];
    if (!fn) throw new Error(`No handler registered for cron job "${job.name}"`);
    return fn(job.data);
  },
  { connection, concurrency: 1 } // sweeps should not overlap themselves
);

// --- Transfers worker: rate-limited global handler for /transfer ---
const TRANSFER_RATE_LIMIT_MAX = Number(process.env.NOMBA_TRANSFER_RATE_LIMIT_MAX ?? 10);
const TRANSFER_RATE_LIMIT_DURATION_MS = Number(process.env.NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS ?? 1000);

const transfersWorker = new Worker(
  QueueName.TRANSFERS,
  async (job) => {
    const { destinationAccount, destinationBank, accountName, amountKobo, merchantTxRef, narration } = job.data;

    const response = await nomba.transferToBankAccount({
      accountNumber: destinationAccount,
      accountName,
      bankCode: destinationBank,
      amount: Number(amountKobo), // confirm: does Nomba expect kobo or Naira here?
      merchantTxRef,
      senderName: PLATFORM_SENDER_NAME,
      narration,
    });

    if (job.name === TransferJob.REFUND) {
      // mark refund settled, update ledger, etc.
    } else {
      // mark payout settled, update ledger, flip `fired` confirmation, etc.
    }

    return response;
  },
  {
    connection: redisConnection,
    concurrency: 5,
    limiter: { max: TRANSFER_RATE_LIMIT_MAX, duration: TRANSFER_RATE_LIMIT_DURATION_MS },
  }
);

// --- Failed job tracking for both queues ---
const cronEvents = FailedJobTracker.attach(QueueName.PAYOUT_CRON, connection);
const transferEvents = FailedJobTracker.attach(QueueName.TRANSFERS, connection);

for (const w of [payoutCronWorker, transfersWorker]) {
  w.on('failed', (job, err) => {
    console.error(`[${w.name}] job ${job?.id} (${job?.name}) failed:`, err.message);
  });
}

async function shutdown() {
  await Promise.all([
    payoutCronWorker.close(),
    transfersWorker.close(),
    cronEvents.close(),
    transferEvents.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('BullMQ worker process started.');