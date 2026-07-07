import { Worker, QueueEvents, DelayedError, type Job } from 'bullmq';
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
import { RedisTransferThrottle } from '@/integrations/nomba/transfer-throttle';
import { clearPendingOperation, decrementPendingOperationLeg } from '@/modules/pots/pots.service';
import type { DisbursementJobData } from '@/modules/scheduler/disbursement-job.types';
import { koboToNairaString } from '@/lib/money';
import { OUTBOUND_FEE, outboundFeeLegs } from '@/lib/fees';

import { recurringPayoutConfigs, scheduledPayoutLegs } from '@/db';
import type { DisbursementOnSuccess } from '@/modules/scheduler/disbursement-job.types';

// Each Worker/QueueEvents gets its own Redis connection — see createRedisConnection()'s comment.
const cronWorkerConnection = createRedisConnection();
const transfersWorkerConnection = createRedisConnection();
const cronEventsConnection = createRedisConnection();
const transferEventsConnection = createRedisConnection();

const handlers = PayoutCronHandlers;

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

// Nomba caps transfers to the SAME recipient at 5/minute (confirmed via
// the Nomba dashboard's own rate-limit notice on POST /v2/transfers/bank),
// independent of and much narrower than TRANSFER_RATE_LIMIT_MAX above
// (which is global across every recipient). A recurring payout config
// firing repeatedly to the same fixed destination, or several pots paying
// out to the same bank account within the same minute, can trip this even
// while comfortably under the global limit — see transfer-throttle.ts.
const transferThrottleConnection = createRedisConnection();
const transferThrottle = new RedisTransferThrottle(transferThrottleConnection);
const TRANSFER_THROTTLE_RETRY_DELAY_MS = 15_000;

/** Delays `job` and signals BullMQ it was deliberately postponed (not failed) via DelayedError — distinct from the attempts:1 no-retry policy, since the job was never actually attempted. */
async function delayForThrottle(job: Job, token: string): Promise<never> {
  await job.moveToDelayed(Date.now() + TRANSFER_THROTTLE_RETRY_DELAY_MS, token);
  throw new DelayedError();
}

async function callNomba(data: DisbursementJobData, resolved: { accountName: string }) {
  const amount = BigInt(data.amount);

  const transfer = await nomba.transferToBankAccount({
    amountNaira: Number(koboToNairaString(amount)), // Nomba expects Naira, not kobo — confirmed
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
  const platformRevenue = await AccountsService.getOrCreateSystemAccount('platform_revenue');
  const nombaFeeExpense = await AccountsService.getOrCreateSystemAccount('nomba_fee_expense');
  const nombaClearing = await AccountsService.getOrCreateSystemAccount('nomba_clearing');
  // amount is what the recipient actually receives — the pot is additionally debited the flat
  // ₦50 outbound fee on top (see apps/backend/src/lib/fees.ts); postFixedAmountDisbursement/
  // postContributorsRefund already verified the balance covers amount + OUTBOUND_FEE before
  // enqueueing this job, but re-check here too since balance can still move in the interim.
  const amount = BigInt(data.amount);

  const balance = await LedgerService.getBalance(potAccount.id);
  if (balance < amount + OUTBOUND_FEE) {
    await releaseLock(data);
    throw new Error(`Pot ${data.potId} balance insufficient for ${data.kind} of ${amount} kobo plus the ₦50 outbound fee`);
  }

  const resolved = await nomba.lookupBankAccount(data.destinationAccount, data.destinationBank);

  let transaction;
  try {
    transaction = await LedgerService.postTransaction({
      type: data.kind === 'payout' ? 'payout' : 'refund',
      reference: data.reference,
      status: 'processing',
      entries: outboundFeeLegs(
        {
          potAccountId: potAccount.id,
          platformFloatId: platformFloat.id,
          platformRevenueId: platformRevenue.id,
          nombaFeeExpenseId: nombaFeeExpense.id,
          nombaClearingId: nombaClearing.id,
        },
        amount
      ),
      metadata: data.contributorUserId
        ? { potId: data.potId, contributorUserId: data.contributorUserId, destinationAccountName: resolved.accountName }
        : { potId: data.potId, destinationAccountName: resolved.accountName },
    });

    await db.update(pots).set({ pendingOperationTransactionId: transaction.id }).where(eq(pots.id, data.potId));

    const { transfer } = await callNomba(data, resolved);

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

/** Contribution-expiry refund — the contribution never reached 'funded' so nothing exists in the ledger to reverse; just moves money back to the sender and marks the payment refunded. */
async function processContributionRefund(data: Extract<DisbursementJobData, { kind: 'contribution_refund' }>) {
  const resolved = await nomba.lookupBankAccount(data.destinationAccount, data.destinationBank);
  const { transfer } = await callNomba(data, resolved);

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

/** Applies a job's declared side effect only after the transfer has actually succeeded, so fired/nextRunAt state reflects reality, not just an attempt. */
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
  async (job, token) => {
    const startedAt = new Date().toISOString();
    console.log(`[transfer] ${job.name} (job ${job.id}) started at ${startedAt}`, job.data);

    const data = job.data as DisbursementJobData;

    // Reserved BEFORE dispatching to either processor below — specifically
    // so a throttled job gets pushed back before processLedgerDisbursement
    // posts its ledger transaction (status 'processing') rather than
    // after. Delaying post-posting would mean DelayedError propagates
    // through that function's try/catch as if the transfer attempt itself
    // had failed, wrongly reversing a transaction that was never actually
    // attempted (see that function's own confirmedNotExecuted comment,
    // which assumes any thrown error there came from a real Nomba call).
    // reserve() is atomic (a single Redis EVAL) rather than a separate
    // check-then-record pair, so two jobs to the SAME recipient racing
    // under this worker's concurrency:5 can't both slip through before
    // either counts against the cap.
    //
    // Wrapped in its own try/catch: reserve() talks to a dedicated Redis
    // connection (transferThrottleConnection) that's independent of the
    // job queue's own connection, so a Redis blip here is an
    // infrastructure failure, not a throttle decision or a Nomba outcome.
    // Left uncaught, it would propagate out of this processor exactly
    // like a real transfer failure — attempts:1 sends it straight to
    // failed_jobs — but no ledger transaction was ever posted and no lock
    // cleanup path runs (that only happens inside processLedgerDisbursement/
    // processContributionRefund's own try/catch, neither of which was
    // entered), leaving a payout/refund's pendingOperation lock stuck on
    // the pot indefinitely. Release the lock here explicitly before
    // rethrowing, mirroring processLedgerDisbursement's own
    // "failed before any ledger entry was posted — nothing to reverse,
    // just release the lock" branch.
    let reserved: boolean;
    try {
      reserved = await transferThrottle.reserve(data.destinationAccount, data.destinationBank);
    } catch (err) {
      console.error(
        `[transfer] job ${job.id} throttle reserve() failed (infra error, not a real transfer attempt) — releasing lock and failing the job:`,
        err
      );
      if (data.kind === 'payout' || data.kind === 'pot_refund') {
        await releaseLock(data);
      }
      throw err;
    }

    if (!reserved) {
      console.log(
        `[transfer] job ${job.id} delayed — recipient ${data.destinationBank}:${data.destinationAccount} at Nomba's per-recipient transfer cap`
      );
      await delayForThrottle(job, token as string);
    }

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