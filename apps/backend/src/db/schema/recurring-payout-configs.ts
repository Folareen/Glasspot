import { pgTable, uuid, text, bigint, integer, timestamp } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for payoutMode='recurring': pays a fixed amount to a single destination every
 * intervalDays, indefinitely until the pot closes (no occurrence cap). One row per pot, set
 * during 'draft' and immutable once 'open'. If balance is below amount when nextRunAt hits, that
 * occurrence must be satisfied before advancing — surfaced, never blind-retried.
 */
export const recurringPayoutConfigs = pgTable('recurring_payout_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .unique()
    .references(() => pots.id, { onDelete: 'cascade' }),
  destinationAccount: text('destination_account').notNull(),
  destinationBank: text('destination_bank').notNull(),
  /** account holder name resolved via Nomba's lookup at save time — see verifyAccountDetails() */
  destinationAccountName: text('destination_account_name').notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  intervalDays: integer('interval_days').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RecurringPayoutConfig = typeof recurringPayoutConfigs.$inferSelect;
export type NewRecurringPayoutConfig = typeof recurringPayoutConfigs.$inferInsert;
