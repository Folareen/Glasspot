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
 *   pending  - virtual account created, no funding webhook received yet.
 *   underpaid - at least one payment received (see contribution-payments.ts),
 *              but SUM(contribution_payments.amount) is still below
 *              expectedAmount — a top-up, not a terminal state. The
 *              virtual account stays open for further transfers until
 *              either the total reaches expectedAmount (-> funded) or
 *              expiresAt passes (-> failed, each payment refunded to its
 *              own sender — see ExpiryService).
 *   funded   - accumulated payments reached/exceeded expectedAmount;
 *              ledger transaction posted for exactly expectedAmount
 *              (never the received total — see system-rules.md); any
 *              excess on the payment that tipped it over is refunded via
 *              refundOverpayment(). transactionId set once posted.
 *   failed   - expiresAt passed while still pending/underpaid; virtual
 *              account released via Nomba's expire endpoint, any partial
 *              payments refunded individually to their own senders.
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
 * incoming webhook back to this row. expiresAt is set at creation
 * (createdAt + a fixed window) and passed to Nomba as the virtual
 * account's own expiryDate — see ContributionsService.create.
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
 *
 * contributorUserId is nullable: a public pot accepts contributions from
 * an unauthenticated caller too (spec.md: "public: anyone can view and
 * contribute"), and there is then no users row to attach. An anonymous
 * contributor to a refundType='contributors' pot MAY supply
 * refundAccountNumber/refundBankCode at contribution time (see
 * ContributionsService.create); if omitted, PotsService's
 * postContributorsRefund falls back to refunding each of this
 * contribution's actual funding payments to its own sender account
 * instead. Each anonymous contribution is refunded as its OWN independent
 * leg (see postContributorsRefund) — never grouped with another anonymous
 * contribution, since there is no shared identity to group them by.
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
    .references(() => users.id),
  virtualAccountRef: text('virtual_account_ref').unique().notNull(),
  virtualAccountNumber: text('virtual_account_number'),
  expectedAmount: bigint('expected_amount', { mode: 'bigint' }).notNull(),
  status: contributionStatusEnum('status').notNull().default('pending'),
  anonymous: boolean('anonymous').notNull().default(false),
  refundAccountNumber: text('refund_account_number'),
  refundAccountName: text('refund_account_name'),
  refundBank: text('refund_bank'),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  fundedAt: timestamp('funded_at', { withTimezone: true }),
});

export type Contribution = typeof contributions.$inferSelect;
export type NewContribution = typeof contributions.$inferInsert;
