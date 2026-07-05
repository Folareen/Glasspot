// src/queues/names.ts
export const QueueName = {
  PAYOUT_CRON: 'payout-cron',
  TRANSFERS: 'transfers',
} as const;

export const PayoutCronJob = {
  TARGET_BASED_SWEEP: 'target-based-sweep',
  RECURRING_SWEEP: 'recurring-sweep',
  EXPIRY_SWEEP: 'expiry-sweep',
  RECONCILIATION: 'reconciliation',
} as const;

export const TransferJob = {
  PAYOUT: 'payout',
  REFUND: 'refund',
} as const;

// Lower number = higher priority in BullMQ
export const TransferPriority = {
  PAYOUT: 1,
  REFUND: 10,
} as const;