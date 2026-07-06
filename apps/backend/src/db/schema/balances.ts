import { pgTable, uuid, bigint, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts';

/**
 * Materialized running balance per account, written atomically in the same DB transaction as
 * the ledgerEntries that produced it — a read cache, never the source of truth. availableBalance
 * currently always equals ledgerBalance (no holds table yet); kept separate to avoid a migration
 * later. version is for audit visibility only, not a lock — concurrency is protected by
 * `SELECT ... FOR UPDATE` in ledger.service.ts, not optimistic locking on this column.
 */
export const balances = pgTable('balances', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  ledgerBalance: bigint('ledger_balance', { mode: 'bigint' }).notNull().default(sql`0`),
  availableBalance: bigint('available_balance', { mode: 'bigint' }).notNull().default(sql`0`),
  version: integer('version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Balance = typeof balances.$inferSelect;
export type NewBalance = typeof balances.$inferInsert;
