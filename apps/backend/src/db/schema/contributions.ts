import { pgTable, uuid, text, bigint, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';
import { transactions } from './transactions';

/**
 * One row per contribution attempt (one virtual account each). Tracks the funding lifecycle
 * before any ledger posting happens — transactionId is only set once the provider confirms
 * funding, never from a client-supplied amount.
 *
 * status: pending (account created, unfunded) -> underpaid (partial payment(s) received, still
 * below expectedAmount, account stays open for more transfers) -> funded (total reached
 * expectedAmount; ledger posts for exactly expectedAmount, any excess refunded via
 * refundOverpayment()) or failed (expiresAt passed while pending/underpaid; each partial payment
 * refunded to its own sender). funded can later become reversed if Nomba sends a
 * payment_reversal; transactionId still points at the original transaction, the clawback is a
 * separate reversing transaction (ledger entries are never edited).
 *
 * virtualAccountRef is our idempotency key sent to Nomba; virtualAccountNumber is Nomba's NUBAN
 * used to match incoming webhooks.
 *
 * refundAccountNumber/refundAccountName/refundBank are only used for refundType='contributors'
 * pots — refundAccountName is resolved via Nomba's lookup at contribution time, never trusted
 * from client input. Null for refundType='admin' pots (the admin's own profile destination is
 * used instead).
 *
 * contributorUserId is nullable because public pots accept unauthenticated contributions. An
 * anonymous contributor to a refundType='contributors' pot may supply a refund account; if
 * omitted, postContributorsRefund falls back to refunding each underlying payment to its own
 * sender, each as an independent leg (no shared identity to group anonymous contributions by).
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
  virtualAccountBankName: text('virtual_account_bank_name'),
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
