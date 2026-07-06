// src/worker.ts
import { Worker, QueueEvents } from 'bullmq';
import { createRedisConnection } from '@/config/redis';
import env from '@/config/env';
import { QueueName, PayoutCronJob, TransferJob } from '@/queues/names';
import { PayoutCronHandlers } from '@/modules/scheduler/payout-cron-handlers';
import { FailedJobTracker } from '@/modules/scheduler/failed-job-tracker';
import { TransferQueueService } from '@/modules/scheduler/transfer-queue.service';
import { eq } from 'drizzle-orm';
import db, { pots, targetBasedPayoutConfigs, contributionPayments } from '@/db';
import { AccountsService } from '@/modules/ledger/accounts.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { nomba } from '@/integrations/nomba/index';
import { NombaApiError } from '@/integrations/nomba/nomba.error';
import { clearPendingOperation, decrementPendingOperationLeg } from '@/modules/pots/pots.service';
import type { DisbursementJobData } from '@/modules/scheduler/disbursement-job.types';

import { recurringPayoutConfigs, scheduledPayoutLegs } from '@/db';
import type { DisbursementOnSuccess } from '@/modules/scheduler/disbursement-job.types';

// Each Worker/QueueEvents gets its own Redis connection — see createRedisConnection()'s comment.
const cronWorkerConnection = createRedisConnection();
const transfersWorkerConnection = createRedisConnection();
const cronEventsConnection = createRedisConnection();
const transferEventsConnection = createRedisConnection();

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

    const startedAt = new Date().toISOString();
    console.log(`[cron] ${job.name} (job ${job.id}) started at ${startedAt}`);

    const result = await fn(job.data);

    console.log(`[cron] ${job.name} (job ${job.id}) finished:`, result);
    return result;
  },
  { connection: cronWorkerConnection, concurrency: 1 } // sweeps should not overlap themselves
);

// --- Transfers worker: rate-limited global handler for /transfer ---

const PLATFORM_SENDER_NAME = 'Glasspot';

const TRANSFER_RATE_LIMIT_MAX = env.NOMBA_TRANSFER_RATE_LIMIT_MAX;
const TRANSFER_RATE_LIMIT_DURATION_MS = env.NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS;

async function callNomba(data: DisbursementJobData) {
  const resolved = await nomba.lookupBankAccount(data.destinationAccount, data.destinationBank);
  const amount = BigInt(data.amount);

  const transfer = await nomba.transferToBankAccount({
    amount: Number(amount) / 100, // Nomba expects Naira, not kobo — confirmed
    accountNumber: data.destinationAccount,
    accountName: resolved.accountName,
    bankCode: data.destinationBank,
    merchantTxRef: data.reference,
    senderName: PLATFORM_SENDER_NAME,
    narration:
      data.kind === 'contribution_refund'
        ? `Glasspot contribution refund`
        : data.kind === 'pot_refund'
        ? `Glasspot refund for pot ${data.potId}`
        : `Glasspot payout for pot ${data.potId}`,
  });

  return { transfer, amount };
}

/** Payout or pot-level refund — posts a ledger transaction, resolves the pot's pendingOperation lock. */
async function processLedgerDisbursement(data: Extract<DisbursementJobData, { kind: 'payout' | 'pot_refund' }>) {
  const potAccount = await AccountsService.getOrCreatePotAccount(data.potId);
  const platformFloat = await AccountsService.getOrCreateSystemAccount('platform_float');
  const amount = BigInt(data.amount);

  const balance = await LedgerService.getBalance(potAccount.id);
  if (balance < amount) {
    await releaseLock(data);
    throw new Error(`Pot ${data.potId} balance insufficient for ${data.kind} of ${amount} kobo`);
  }

  let transaction;
  try {
    transaction = await LedgerService.postTransaction({
      type: data.kind === 'payout' ? 'payout' : 'refund',
      reference: data.reference,
      status: 'processing',
      entries: [
        { accountId: potAccount.id, direction: 'debit', amount: amount },
        { accountId: platformFloat.id, direction: 'credit', amount: amount },
      ],
      metadata: data.contributorUserId
        ? { potId: data.potId, contributorUserId: data.contributorUserId }
        : { potId: data.potId },
    });

    await db.update(pots).set({ pendingOperationTransactionId: transaction.id }).where(eq(pots.id, data.potId));

    const { transfer } = await callNomba(data);

    // inside processLedgerDisbursement, replacing the single mark_target_based_fired branch
    if (transfer.status === 'SUCCESS') {
      await LedgerService.markCompleted(transaction.id);
      await releaseLock(data);

      if (data.onSuccess) {
        await applyOnSuccess(data.onSuccess);
      }
    }
    // PENDING_BILLING: transaction stays 'processing', lock stays held —
    // resolved later via resolvePendingTransfer on the Nomba webhook.

    return transaction;
  } catch (err) {
    // A NombaApiError with a real HTTP status means Nomba actually
    // received and rejected the request (bad request, insufficient
    // balance, etc) — confirmed not executed, safe to reverse. status 0
    // means the request itself never got a response (network error,
    // timeout, DNS failure) — Nomba may have received and processed it
    // anyway, so the outcome is unknown, not "definitely failed."
    // Reversing here on an unknown outcome risks the ledger saying "money
    // never left" when it actually did, which is worse than leaving the
    // transaction stuck 'processing' — that gets resolved later by the
    // payout webhook or reconciliation, never by blind-retrying
    // (docs/system-rules.md's "confirm not-executed before reversing").
    const confirmedNotExecuted = !(err instanceof NombaApiError) || err.status !== 0;

    if (transaction && confirmedNotExecuted) {
      await LedgerService.reverseTransaction(transaction.id, `${data.reference}_reversal`);
      await releaseLock(data);
    } else if (!transaction) {
      // Failed before any ledger entry was posted (e.g. insufficient
      // balance) — nothing to reverse, just release the lock.
      await releaseLock(data);
    }
    // else: transaction exists but the outcome is unknown — leave it
    // 'processing' and the lock held, same as the PENDING_BILLING path.

    throw err; // attempts:1 → straight to failed_jobs, no auto-retry
  }
}

function releaseLock(data: Extract<DisbursementJobData, { kind: 'payout' | 'pot_refund' }>) {
  return data.isFanOutLeg ? decrementPendingOperationLeg(data.potId) : clearPendingOperation(data.potId);
}

/**
 * Contribution-expiry refund — the contribution never reached 'funded',
 * so no transactions/ledgerEntries row exists for it (see contributions.ts's
 * status comment: transactionId is only ever set once funded). Nothing to
 * reverse in the ledger; this just moves real money back to the original
 * sender and marks the specific payment refunded so ExpiryService's sweep
 * is idempotent per-payment.
 */
async function processContributionRefund(data: Extract<DisbursementJobData, { kind: 'contribution_refund' }>) {
  const { transfer } = await callNomba(data);

  if (transfer.status === 'SUCCESS') {
    await db
      .update(contributionPayments)
      .set({ refunded: true })
      .where(eq(contributionPayments.id, data.contributionPaymentId));
  }
  // PENDING_BILLING: leave refunded=false — ExpiryService's sweep will
  // naturally re-check this payment; resolution still needs to come via
  // Nomba's webhook, same "never blind-retry" rule as the ledger path.

  return transfer;
}

/**
 * Applies a job's declared side effect ONLY after the transfer has
 * actually succeeded — this is what makes fired/nextRunAt/leg-fired
 * state accurately reflect reality rather than "we attempted this,"
 * matching the schema comments' "only advance after actual success" rule
 * for recurring_payout_configs and scheduled_payout_configs.
 */
async function applyOnSuccess(onSuccess: DisbursementOnSuccess) {
  switch (onSuccess.type) {
    case 'mark_target_based_fired':
      await db
        .update(targetBasedPayoutConfigs)
        .set({ fired: true, firedAt: new Date() })
        .where(eq(targetBasedPayoutConfigs.id, onSuccess.targetConfigId));
      return;

    case 'advance_recurring_next_run_at': {
      // Re-read current nextRunAt/intervalDays rather than trusting a
      // value carried in the job payload from enqueue time — avoids
      // compounding drift if this config was somehow touched between
      // enqueue and this job actually running.
      const [config] = await db
        .select()
        .from(recurringPayoutConfigs)
        .where(eq(recurringPayoutConfigs.id, onSuccess.recurringConfigId));
      if (!config) return;
      const nextRunAt = new Date(config.nextRunAt.getTime() + config.intervalDays * 24 * 60 * 60 * 1000);
      await db.update(recurringPayoutConfigs).set({ nextRunAt }).where(eq(recurringPayoutConfigs.id, config.id));
      return;
    }

    case 'mark_scheduled_leg_fired':
      await db
        .update(scheduledPayoutLegs)
        .set({ fired: true, firedAt: new Date() })
        .where(eq(scheduledPayoutLegs.id, onSuccess.scheduledLegId));
      return;
  }
}

const transfersWorker = new Worker(
  QueueName.TRANSFERS,
  async (job) => {
     const startedAt = new Date().toISOString();
    console.log(`[transfer] ${job.name} (job ${job.id}) started at ${startedAt}`, job.data);

    const data = job.data as DisbursementJobData;

    const result = data.kind === 'contribution_refund'
      ? await processContributionRefund(data)
      : await processLedgerDisbursement(data);

    console.log(`[transfer] ${job.name} (job ${job.id}) finished:`, result);

    return result;
  },
  {
    connection: transfersWorkerConnection,
    concurrency: 5,
    limiter: { max: TRANSFER_RATE_LIMIT_MAX, duration: TRANSFER_RATE_LIMIT_DURATION_MS },
  }
);

transfersWorker.on('completed', (job) => {
  console.log(`[transfer] job ${job.id} (${job.name}) completed`);
});

transfersWorker.on('failed', (job, err) => {
  console.error(`[transfer] job ${job?.id} (${job?.name}) FAILED:`, err.message);
});

// --- Failed job tracking for both queues ---
const cronTracker = FailedJobTracker.attach(QueueName.PAYOUT_CRON, cronEventsConnection);
const transferTracker = FailedJobTracker.attach(QueueName.TRANSFERS, transferEventsConnection);

for (const w of [payoutCronWorker, transfersWorker]) {
  w.on('failed', (job, err) => {
    console.error(`[${w.name}] job ${job?.id} (${job?.name}) failed:`, err.message);
  });
}

async function shutdown() {
  await Promise.all([
    payoutCronWorker.close(),
    transfersWorker.close(),
    cronTracker.events.close(),
    transferTracker.events.close(),
    cronTracker.queue.close(),
    transferTracker.queue.close(),
  ]);
  await Promise.all([
    cronWorkerConnection.quit(),
    transfersWorkerConnection.quit(),
    cronEventsConnection.quit(),
    transferEventsConnection.quit(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('BullMQ worker process started.');