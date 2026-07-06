import { pgTable, uuid, text, bigint, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';

/**
 * The business-readable wrapper around a money event (funding, contribution, payout, etc); one
 * transaction can spawn multiple ledgerEntries rows. status is the transaction's own lifecycle —
 * entries themselves are immutable and have no status. reference is our idempotency key, unique
 * so a retry never double-posts; externalReference is Nomba's id, nullable for purely-internal
 * transactions. amount is informational/gross only — never derive a balance from it, only from
 * the sum of this transaction's ledgerEntries.
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
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
