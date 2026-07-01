import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for a pot with payoutMode = 'manual'. No condition — any pot
 * admin (or the creator) can trigger a payout to this destination at any
 * time, and it can fire more than once over the pot's lifetime. Because it
 * can fire repeatedly, this table intentionally has no fired/firedAt —
 * individual payout events belong to a payout execution/ledger record
 * (Milestone 2), not to the rule config.
 *
 * One row per pot (potId unique). Set once while the pot is 'draft' and
 * immutable once the pot is 'open' — see pots.ts status semantics.
 */
export const manualPayoutConfigs = pgTable('manual_payout_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .unique()
    .references(() => pots.id, { onDelete: 'cascade' }),
  destinationAccount: text('destination_account').notNull(),
  destinationBank: text('destination_bank').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ManualPayoutConfig = typeof manualPayoutConfigs.$inferSelect;
export type NewManualPayoutConfig = typeof manualPayoutConfigs.$inferInsert;
