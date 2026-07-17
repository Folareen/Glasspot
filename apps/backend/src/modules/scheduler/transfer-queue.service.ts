// src/modules/scheduler/transfer-queue.service.ts
import { transfersQueue } from '@/queues/queues';
import { TransferJob, TransferPriority } from '@/queues/names';
import type { DisbursementJobData } from './disbursement-job.types';

// Default retry policy for every transfer job: up to 5 attempts with exponential backoff, so a
// transient Nomba 5xx or network blip gets BullMQ's own retry instead of landing straight in
// failed_jobs on the first hiccup. This is NOT the right policy for a deterministic failure
// (insufficient balance, a confirmed Nomba rejection) — those throw BullMQ's UnrecoverableError
// from inside the processor (see worker.ts), which skips all remaining attempts regardless of this
// config and goes straight to failed_jobs, same as the old blanket attempts:1 did for every case.
const TRANSFER_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
} as const;

export const TransferQueueService = {
  async enqueuePayout(payload: Extract<DisbursementJobData, { kind: 'payout' }>) {
    return transfersQueue.add(TransferJob.PAYOUT, payload, {
      jobId: payload.reference, // reference is already a unique idempotency key everywhere it's constructed — a duplicate enqueue with the same jobId is a BullMQ no-op
      priority: TransferPriority.PAYOUT,
      ...TRANSFER_JOB_OPTS,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },

  async enqueuePotRefund(payload: Extract<DisbursementJobData, { kind: 'pot_refund' }>) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      jobId: payload.reference,
      priority: TransferPriority.REFUND,
      ...TRANSFER_JOB_OPTS,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },

  async enqueueContributionRefund(payload: Extract<DisbursementJobData, { kind: 'contribution_refund' }>) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      jobId: payload.reference, // expiry.service.ts's reference is deterministic (expiry_refund_<paymentId>), so a re-run of the same sweep before this job finishes is a no-op rather than a second Nomba call
      priority: TransferPriority.REFUND, // same low priority as pot refunds — neither blocks payouts
      ...TRANSFER_JOB_OPTS,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },
};