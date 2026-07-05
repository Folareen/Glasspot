// src/worker.ts
import { Worker, QueueEvents } from 'bullmq';
import redisConnection from '@/config/redis';
import { QueueName, PayoutCronJob, TransferJob } from '@/queues/names';
import { PayoutCronHandlers } from '@/modules/scheduler/payout-cron-handlers';
import { FailedJobTracker } from '@/modules/scheduler/failed-job-tracker';
import { TransferQueueService } from '@/modules/scheduler/transfer-queue.service';
import { eq } from 'drizzle-orm';
import db, { pots, targetBasedPayoutConfigs, contributionPayments } from '@/db';
import { AccountsService } from '@/modules/ledger/accounts.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { nomba } from '@/integrations/nomba/index';
import { clearPendingOperation, decrementPendingOperationLeg } from '@/modules/pots/pots.service';
import type { DisbursementJobData } from '@/modules/scheduler/disbursement-job.types';

import { recurringPayoutConfigs, scheduledPayoutLegs } from '@/db';
import type { DisbursementOnSuccess } from '@/modules/scheduler/disbursement-job.types';

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

const PLATFORM_SENDER_NAME = 'Glasspot';

const TRANSFER_RATE_LIMIT_MAX = Number(process.env.NOMBA_TRANSFER_RATE_LIMIT_MAX ?? 10);
const TRANSFER_RATE_LIMIT_DURATION_MS = Number(process.env.NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS ?? 1000);

async function callNomba(data: DisbursementJobData) {
  const resolved = await nomba.lookupBankAccount(data.destinationAccount, data.destinationBank);
  const amount = BigInt(data.amountKobo);

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
        : `Glasspot ${data.kind} for pot ${data.potId}`,
  });

  return { transfer, amount };
}

/** Payout or pot-level refund — posts a ledger transaction, resolves the pot's pendingOperation lock. */
async function processLedgerDisbursement(data: Extract<DisbursementJobData, { kind: 'payout' | 'pot_refund' }>) {
  const potAccount = await AccountsService.getOrCreatePotAccount(data.potId);
  const platformFloat = await AccountsService.getOrCreateSystemAccount('platform_float');
  const amount = BigInt(data.amountKobo);

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
        { accountId: potAccount.id, direction: 'debit', amountKobo: amount },
        { accountId: platformFloat.id, direction: 'credit', amountKobo: amount },
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
    if (transaction) {
      await LedgerService.reverseTransaction(transaction.id, `${data.reference}_reversal`);
    }
    await releaseLock(data);
    throw err; // attempts:1 → straight to failed_jobs, no auto-retry
  }
}

function releaseLock(data: Extract<DisbursementJobData, { kind: 'payout' | 'pot_refund' }>) {
  return data.contributorUserId ? decrementPendingOperationLeg(data.potId) : clearPendingOperation(data.potId);
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
    const data = job.data as DisbursementJobData;

    if (data.kind === 'contribution_refund') {
      return processContributionRefund(data);
    }
    return processLedgerDisbursement(data);
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