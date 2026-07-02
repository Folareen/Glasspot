import { pgTable, uuid, text, bigint, boolean, timestamp } from 'drizzle-orm/pg-core';
import { contributions } from './contributions';

/**
 * One row per INBOUND TRANSFER against a contribution's virtual account —
 * not one row per contribution. A single virtual account can legitimately
 * receive more than one transfer (top-up toward an underpaid contribution,
 * or two different people paying into the same account), and each
 * transfer has its own sender to refund if the contribution ultimately
 * expires unfunded — see contributions.ts's expiresAt/ContributionsService
 * comments. contributions.receivedAmountKobo does not exist as a stored
 * column; the running total is always SUM(amountKobo) over this table,
 * same "derive, never store" principle as ledger balances.
 *
 * nombaTransactionId is Nomba's own transaction id for this specific
 * transfer (payment.transaction.transactionId on the funding webhook) and
 * is unique — the dedupe key for a redelivered payment_success webhook
 * for the SAME transfer, distinct from provider_events' top-level
 * requestId dedupe (see nomba-webhooks.service.ts) which only protects
 * against redelivery of one event, not against double-crediting if two
 * different webhook events ever pointed at the same underlying transfer.
 */
export const contributionPayments = pgTable('contribution_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  contributionId: uuid('contribution_id')
    .notNull()
    .references(() => contributions.id),
  nombaTransactionId: text('nomba_transaction_id').unique().notNull(),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  senderAccountNumber: text('sender_account_number').notNull(),
  senderBankCode: text('sender_bank_code').notNull(),
  senderName: text('sender_name').notNull(),
  // Set true once ExpiryService has sent this specific payment's refund
  // back to senderAccountNumber — makes the sweep idempotent per-payment
  // rather than per-contribution (see ExpiryService: two payments on one
  // expired contribution refund independently).
  refunded: boolean('refunded').notNull().default(false),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContributionPayment = typeof contributionPayments.$inferSelect;
export type NewContributionPayment = typeof contributionPayments.$inferInsert;
