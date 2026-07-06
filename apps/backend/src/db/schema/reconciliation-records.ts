import { pgTable, uuid, text, bigint, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { settlementBatches } from './settlement-batches';
import { transactions } from './transactions';

/**
 * One row per reconciliation finding — every run inserts rather than mutating transactions
 * directly, so discrepancy history is never lost. settlementBatchId/transactionId are both
 * nullable since a finding can exist before either side is known ('unmatched_external' = no
 * matching local transaction yet). status='amount_mismatch' is never auto-resolved;
 * resolutionNote records a human's manual review outcome.
 */
export const reconciliationStatusEnum = pgEnum('reconciliation_status', [
  'matched',
  'unmatched_internal',
  'unmatched_external',
  'amount_mismatch',
  'resolved',
]);

export const reconciliationRecords = pgTable('reconciliation_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  settlementBatchId: uuid('settlement_batch_id').references(() => settlementBatches.id),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  externalReference: text('external_reference').notNull(),
  internalAmount: bigint('internal_amount', { mode: 'bigint' }),
  externalAmount: bigint('external_amount', { mode: 'bigint' }),
  status: reconciliationStatusEnum('status').notNull(),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReconciliationRecord = typeof reconciliationRecords.$inferSelect;
export type NewReconciliationRecord = typeof reconciliationRecords.$inferInsert;
