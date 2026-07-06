import { pgTable, uuid, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pots } from './pots';

/**
 * Optional payout rule for payoutMode='manual'. destinationAccount/destinationBank are nullable
 * — if unset, the triggering admin names a destination at payout time; if set, they act as a
 * default while still allowing the admin to trigger payout repeatedly (unlike target_based's
 * fire-once). One row per pot, only inserted if a destination was provided at creation; set
 * during 'draft' and immutable once the pot is 'open'.
 */
export const manualPayoutConfigs = pgTable(
  'manual_payout_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    potId: uuid('pot_id')
      .notNull()
      .unique()
      .references(() => pots.id, { onDelete: 'cascade' }),
    destinationAccount: text('destination_account'),
    destinationBank: text('destination_bank'),
    /** account holder name resolved via Nomba's lookup at save time — see verifyAccountDetails(); null iff destinationAccount/destinationBank are also unset */
    destinationAccountName: text('destination_account_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bothOrNeitherCheck: check(
      'chk_manual_destination_both_or_neither',
      sql`(${table.destinationAccount} IS NULL AND ${table.destinationBank} IS NULL) OR (${table.destinationAccount} IS NOT NULL AND ${table.destinationBank} IS NOT NULL)`
    ),
  })
);

export type ManualPayoutConfig = typeof manualPayoutConfigs.$inferSelect;
export type NewManualPayoutConfig = typeof manualPayoutConfigs.$inferInsert;
