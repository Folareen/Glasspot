import { pgTable, uuid, text, bigint, timestamp, pgEnum } from 'drizzle-orm/pg-core';

/**
 * One row per reconciliation window against a provider (Nomba) — compares
 * what our ledger expected for the period (expectedAmount, summed from
 * our own transactions) against what the provider's settlement report says
 * actually moved (reportedAmount). Both are kobo integers, per
 * docs/system-rules.md. status tracks the outcome of that comparison;
 * reconciliationRecords holds the line-item detail behind it.
 */
export const settlementBatchStatusEnum = pgEnum('settlement_batch_status', [
  'open',
  'matched',
  'mismatched',
  'resolved',
]);

export const settlementBatches = pgTable('settlement_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  batchReference: text('batch_reference').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  expectedAmount: bigint('expected_amount', { mode: 'bigint' }).notNull(),
  reportedAmount: bigint('reported_amount', { mode: 'bigint' }),
  status: settlementBatchStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SettlementBatch = typeof settlementBatches.$inferSelect;
export type NewSettlementBatch = typeof settlementBatches.$inferInsert;
