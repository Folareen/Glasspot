import { pgTable, uuid, text, bigint, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';

/**
 * The business-readable wrapper around a real-world money event — "user
 * funded wallet," "user contributed to pot," "pot paid out." One
 * transaction can (and for fees, always does) spawn multiple ledgerEntries
 * rows. status here is the transaction's own lifecycle, not any single
 * entry's — entries themselves have no status, they're immutable once
 * written (see ledger-entries.ts).
 *
 * reference is OUR idempotency key (caller-supplied or derived), unique so
 * a retried request can never double-post. externalReference is Nomba's
 * transaction id, used to match against provider_events/reconciliation —
 * nullable since purely-internal transactions (a contribution moving
 * wallet -> pot) never touch Nomba at all.
 *
 * amountKobo is informational/gross only — the real truth of what moved
 * where is always the sum of this transaction's ledgerEntries, never this
 * column. Never derive a balance from it.
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
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  metadata: jsonb('metadata'),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
