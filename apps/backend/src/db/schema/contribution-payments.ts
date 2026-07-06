import { pgTable, uuid, text, bigint, boolean, timestamp } from 'drizzle-orm/pg-core';
import { contributions } from './contributions';

/**
 * One row per inbound transfer against a contribution's virtual account, not per contribution —
 * a single account can receive multiple transfers (top-ups, multiple payers), each with its own
 * sender to refund if the contribution expires unfunded. Received total is always SUM(amount)
 * here, never a stored column (same derive-never-store principle as ledger balances).
 * nombaTransactionId is Nomba's own id for this transfer and is the dedupe key for a redelivered
 * payment_success webhook, distinct from provider_events' event-level dedupe.
 */
export const contributionPayments = pgTable('contribution_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  contributionId: uuid('contribution_id')
    .notNull()
    .references(() => contributions.id),
  nombaTransactionId: text('nomba_transaction_id').unique().notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  senderAccountNumber: text('sender_account_number').notNull(),
  senderBankCode: text('sender_bank_code').notNull(),
  senderName: text('sender_name').notNull(),
  // True once ExpiryService has refunded this payment back to senderAccountNumber — makes the
  // expiry sweep idempotent per-payment rather than per-contribution.
  refunded: boolean('refunded').notNull().default(false),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContributionPayment = typeof contributionPayments.$inferSelect;
export type NewContributionPayment = typeof contributionPayments.$inferInsert;
