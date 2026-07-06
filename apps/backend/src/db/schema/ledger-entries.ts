import { pgTable, uuid, bigint, timestamp, pgEnum, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { transactions } from './transactions';
import { accounts } from './accounts';

/**
 * The debit/credit lines — append-only, immutable, source of truth for every balance. No UPDATE
 * or DELETE ever touches this table; a correction posts a new reversing transaction instead.
 * amount (kobo, always positive) with direction carrying the sign; balanceAfter is an audit
 * snapshot only, not the balance read path (that's `balances`, updated in the same transaction).
 * The debits==credits-per-transaction invariant is enforced in ledger.service.ts's
 * postTransaction, not by a DB constraint (no portable way to assert a sibling-row aggregate at
 * insert time).
 */
export const ledgerDirectionEnum = pgEnum('ledger_direction', ['debit', 'credit']);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    direction: ledgerDirectionEnum('direction').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    amountPositiveCheck: check('chk_ledger_entries_amount_positive', sql`${table.amount} > 0`),
    transactionIdIdx: index('ledger_entries_transaction_id_idx').on(table.transactionId),
    accountIdIdx: index('ledger_entries_account_id_idx').on(table.accountId),
  })
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
