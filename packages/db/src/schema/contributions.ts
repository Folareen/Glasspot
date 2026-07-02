import { pgTable, uuid, text, bigint, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';
import { transactions } from './transactions';

/**
 * One row per contribution attempt (see spec-mvp.md: one virtual account
 * per contribution). Tracks the funding lifecycle BEFORE any money has
 * actually moved — the ledger transaction (transactionId) only exists once
 * the provider confirms funding, since we never post to the ledger on a
 * client-supplied amount alone (see docs/system-rules.md). This table is
 * the source of truth for "did this contribution ever get paid," not the
 * ledger, which only knows about contributions that succeeded.
 *
 * status:
 *   pending  - virtual account created, awaiting the funding webhook.
 *   funded   - webhook confirmed payment at/above expectedAmountKobo;
 *              transactionId is set once the ledger post completes.
 *   underpaid - webhook confirmed payment below expectedAmountKobo; no
 *              ledger transaction posted (see system-rules.md's "no silent
 *              failures" — this must surface, not silently drop).
 *   failed   - virtual account expired or was otherwise abandoned unfunded.
 *
 * virtualAccountRef is OUR accountRef sent to Nomba (the idempotency key
 * for the createVirtualAccount call and what a retry re-derives).
 * virtualAccountNumber is Nomba's returned NUBAN, used to match the
 * incoming webhook back to this row.
 */
export const contributionStatusEnum = pgEnum('contribution_status', [
  'pending',
  'funded',
  'underpaid',
  'failed',
]);

export const contributions = pgTable('contributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .references(() => pots.id),
  contributorUserId: uuid('contributor_user_id')
    .notNull()
    .references(() => users.id),
  virtualAccountRef: text('virtual_account_ref').unique().notNull(),
  virtualAccountNumber: text('virtual_account_number'),
  expectedAmountKobo: bigint('expected_amount_kobo', { mode: 'bigint' }).notNull(),
  status: contributionStatusEnum('status').notNull().default('pending'),
  anonymous: boolean('anonymous').notNull().default(false),
  refundDestination: text('refund_destination'),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  fundedAt: timestamp('funded_at', { withTimezone: true }),
});

export type Contribution = typeof contributions.$inferSelect;
export type NewContribution = typeof contributions.$inferInsert;
