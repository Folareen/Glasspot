import { pgTable, uuid, bigint, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts';

/**
 * Materialized running balance per account, updated atomically in the same
 * DB transaction as the ledgerEntries that affect it — so reads never need
 * to SUM(ledger_entries) on every request. Ledger entries remain the
 * source of truth; this table is a derived cache that must always be
 * reconstructable from them (see sanity checks in system-rules.md).
 *
 * ledgerBalance = everything posted. availableBalance = ledgerBalance minus
 * active holds (not modeled yet in this build — no holds table exists, so
 * availableBalance currently always equals ledgerBalance; kept as a
 * separate column now so adding holds later doesn't require a migration).
 *
 * version is for optimistic locking: ledger.service.ts reads the current
 * version, writes `where version = :read_version`, and retries on
 * conflict — protects against two concurrent postings on the same account
 * racing each other (see system-rules.md's locking requirement).
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
