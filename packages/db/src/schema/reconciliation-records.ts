import { pgTable, uuid, text, bigint, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { settlementBatches } from './settlement-batches';
import { transactions } from './transactions';

/**
 * One row per reconciliation finding — every run INSERTS rows here rather
 * than mutating transactions directly, so discrepancy history and how each
 * was resolved is never lost (see reference doc's reconciliation logic).
 * settlementBatchId/transactionId are both nullable since a finding can
 * exist before either side is known: 'unmatched_external' means the
 * provider reported a transaction with no matching local transactionId at
 * all yet.
 *
 * status='amount_mismatch' is never auto-resolved — resolutionNote exists
 * specifically to record a human's manual review outcome, not an
 * automated one.
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
  internalAmountKobo: bigint('internal_amount_kobo', { mode: 'bigint' }),
  externalAmountKobo: bigint('external_amount_kobo', { mode: 'bigint' }),
  status: reconciliationStatusEnum('status').notNull(),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReconciliationRecord = typeof reconciliationRecords.$inferSelect;
export type NewReconciliationRecord = typeof reconciliationRecords.$inferInsert;
