// src/modules/scheduler/transfer-queue.service.ts
import { transfersQueue } from '@/queues/queues';
import { TransferJob, TransferPriority } from '@/queues/names';
import type { DisbursementJobData } from './disbursement-job.types';

export const TransferQueueService = {
  async enqueuePayout(payload: Extract<DisbursementJobData, { kind: 'payout' }>) {
    return transfersQueue.add(TransferJob.PAYOUT, payload, {
      priority: TransferPriority.PAYOUT,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },

  async enqueuePotRefund(payload: Extract<DisbursementJobData, { kind: 'pot_refund' }>) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      priority: TransferPriority.REFUND,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },

  async enqueueContributionRefund(payload: Extract<DisbursementJobData, { kind: 'contribution_refund' }>) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      priority: TransferPriority.REFUND, // same low priority as pot refunds — neither blocks payouts
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  },
};