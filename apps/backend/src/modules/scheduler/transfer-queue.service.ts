// src/modules/scheduler/transfer-queue.service.ts
import { transfersQueue } from '@/queues/queues';
import { TransferJob, TransferPriority } from '@/queues/names';

interface TransferPayload {
  destinationAccount: string;
  destinationBank: string;
  accountName: string;       // resolved bank account holder name — required by Nomba
  amountKobo: bigint;
  potId: string;
  merchantTxRef: string;     // idempotency key for Nomba
  narration?: string;
}

export const PLATFORM_SENDER_NAME = 'Glasspot'; // or pull from env/config if it varies

export class TransferQueueService {
  static async enqueuePayout(payload: TransferPayload) {
    return transfersQueue.add(TransferJob.PAYOUT, payload, {
      priority: TransferPriority.PAYOUT,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  }

  static async enqueueRefund(payload: TransferPayload) {
    return transfersQueue.add(TransferJob.REFUND, payload, {
      priority: TransferPriority.REFUND,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  }
}