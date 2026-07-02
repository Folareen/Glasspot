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
 *   reversed - was 'funded' (ledger transaction posted), then Nomba sent a
 *              payment_reversal for it — the credited funds were clawed
 *              back out. transactionId still points at the ORIGINAL
 *              contribution transaction; the reversing entry is a
 *              separate transaction (see LedgerService.reverseTransaction —
 *              ledger entries are never edited, only reversed forward).
 *
 * virtualAccountRef is OUR accountRef sent to Nomba (the idempotency key
 * for the createVirtualAccount call and what a retry re-derives).
 * virtualAccountNumber is Nomba's returned NUBAN, used to match the
 * incoming webhook back to this row.
 *
 * refundAccountNumber/refundAccountName/refundBank: only meaningful (and
 * only collected) for a pot with refundType='contributors' — the account
 * THIS contributor gets their own money back to, if the pot's refund ever
 * fires (see pots.ts refundTypeEnum). Structured, not free text, because
 * this is a real transfer destination: refundAccountName is the holder
 * name Nomba's own lookupBankAccount() resolved for refundAccountNumber +
 * refundBank, confirmed at contribution time rather than trusted from
 * client input (see docs/system-rules.md — same validate-before-storing
 * pattern used for every other payout/refund destination in this
 * codebase). Null for refundType='admin' pots, where the admin's own
 * profile destination is used instead (see users.ts).
 */
export const contributionStatusEnum = pgEnum('contribution_status', [
  'pending',
  'funded',
  'underpaid',
  'failed',
  'reversed',
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
  refundAccountNumber: text('refund_account_number'),
  refundAccountName: text('refund_account_name'),
  refundBank: text('refund_bank'),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  fundedAt: timestamp('funded_at', { withTimezone: true }),
});

export type Contribution = typeof contributions.$inferSelect;
export type NewContribution = typeof contributions.$inferInsert;
