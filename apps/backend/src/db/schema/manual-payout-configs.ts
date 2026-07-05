import { pgTable, uuid, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pots } from './pots';

/**
 * Optional payout rule for a pot with payoutMode = 'manual'. destinationAccount/
 * destinationBank are both nullable — if unset, the triggering admin names
 * the destination themselves at the moment of payout (see
 * PotsService.triggerPayout and pots.schema.ts's triggerPayoutSchema). If
 * set, they act as the default destination, matching target_based/recurring's
 * fixed-destination shape, while still allowing the triggering admin to
 * repeat the payout indefinitely (unlike target_based, which fires once).
 *
 * One row per pot (potId unique), and only inserted at all if a destination
 * was actually provided at creation — see PotsService.insertPayoutConfig's
 * 'manual' case. Set once while the pot is 'draft' and immutable once the
 * pot is 'open' — see pots.ts status semantics.
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
