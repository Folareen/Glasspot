import { pgTable, uuid, text, bigint, integer, timestamp } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for a pot with payoutMode = 'recurring'. Pays a fixed amount
 * to a single destination every intervalDays, repeating. nextRunAt is
 * advanced by intervalDays after each fire (execution logic is Milestone 2).
 *
 * One row per pot (potId unique). Set once while the pot is 'draft' and
 * immutable once the pot is 'open' — see pots.ts status semantics.
 *
 * Runs indefinitely until the pot is closed — no occurrence cap or end
 * date. No endsAt/maxOccurrences column.
 *
 * If pot balance is below amountKobo when nextRunAt hits: fail and wait —
 * that occurrence must be satisfied before nextRunAt advances or any later
 * occurrence can fire. Not blind-retried; surfaced per system-rules.md's
 * "no silent failures". Execution/retry logic is Milestone 2 — no schema
 * column needed for this here.
 */
export const recurringPayoutConfigs = pgTable('recurring_payout_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .unique()
    .references(() => pots.id, { onDelete: 'cascade' }),
  destinationAccount: text('destination_account').notNull(),
  destinationBank: text('destination_bank').notNull(),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  intervalDays: integer('interval_days').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RecurringPayoutConfig = typeof recurringPayoutConfigs.$inferSelect;
export type NewRecurringPayoutConfig = typeof recurringPayoutConfigs.$inferInsert;
