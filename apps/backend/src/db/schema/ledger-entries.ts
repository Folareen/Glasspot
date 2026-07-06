import { pgTable, uuid, bigint, timestamp, pgEnum, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { transactions } from './transactions';
import { accounts } from './accounts';

/**
 * The actual debit/credit lines — append-only, immutable, source of truth
 * for every balance in the system. No UPDATE or DELETE ever touches this
 * table (see docs/system-rules.md); correcting a mistake means posting a
 * new transaction with reversing entries, never editing history.
 *
 * amount (a kobo integer) is always positive; direction alone carries the sign meaning
 * (debit vs credit), same convention as the reference doc. balanceAfter is
 * a running-balance snapshot on this entry's account immediately after
 * this entry was applied — an audit trail column, not the read path for
 * "what's the balance now" (that's `balances`, updated atomically
 * alongside this insert in the same DB transaction — see ledger.service.ts).
 *
 * The debits==credits-per-transaction invariant is enforced in
 * ledger.service.ts's postTransaction inside a single DB transaction, not
 * by a DB constraint here — Postgres has no portable way to assert an
 * aggregate over sibling rows at insert time without a deferred trigger,
 * and "abort the whole DB transaction if the check fails before commit"
 * from application code gives the same guarantee.
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
