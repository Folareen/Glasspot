import { pgTable, uuid, text, bigint, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import type { DisbursementOnSuccess } from '@/modules/scheduler/disbursement-job.types';

/**
 * The business-readable wrapper around a money event (funding, contribution, payout, etc); one
 * transaction can spawn multiple ledgerEntries rows. status is the transaction's own lifecycle —
 * entries themselves are immutable and have no status. reference is our idempotency key, unique
 * so a retry never double-posts; externalReference is Nomba's id, nullable for purely-internal
 * transactions. amount is the actual cash moved by this transaction (never a fee-inflated/gross
 * figure) — set explicitly by the poster, since only it knows which leg is real money vs. a fee
 * split; still never derive a balance from it, only from the sum of this transaction's
 * ledgerEntries. onSuccess carries a payout/refund's declared side effect (e.g. "mark this
 * target_based config fired") so it survives past the enqueueing BullMQ job and can still be
 * applied later by the async webhook-driven settlement path (resolvePendingTransfer), not just the
 * worker's own synchronous success branch — see DisbursementOnSuccess in
 * modules/scheduler/disbursement-job.types.ts for its shape.
 */
export const transactionTypeEnum = pgEnum('transaction_type', [
  'funding',
  'contribution',
  'payout',
  'refund',
  'fee',
  'transfer',
  'reversal',
]);
export const transactionStatusEnum = pgEnum('transaction_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'reversed',
]);

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: transactionTypeEnum('type').notNull(),
  status: transactionStatusEnum('status').notNull().default('pending'),
  reference: text('reference').unique().notNull(),
  externalReference: text('external_reference'),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  metadata: jsonb('metadata'),
  onSuccess: jsonb('on_success').$type<DisbursementOnSuccess>(),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
