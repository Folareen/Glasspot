import { pgTable, uuid, text, bigint, boolean, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pots } from './pots';

/**
 * Payout rule for a pot with payoutMode = 'target_based'. Pays out once to
 * a single destination when any configured condition is met (OR, not AND):
 * targetDate reached, targetAmountKobo reached, or an admin manually
 * triggers it. At least one condition must be set — enforced below.
 *
 * One row per pot (potId unique). Set once while the pot is 'draft' and
 * immutable once the pot is 'open' — see pots.ts status semantics.
 */
export const targetBasedPayoutConfigs = pgTable(
  'target_based_payout_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    potId: uuid('pot_id')
      .notNull()
      .unique()
      .references(() => pots.id, { onDelete: 'cascade' }),
    destinationAccount: text('destination_account').notNull(),
    destinationBank: text('destination_bank').notNull(),
    targetDate: timestamp('target_date', { withTimezone: true }),
    targetAmountKobo: bigint('target_amount_kobo', { mode: 'bigint' }),
    adminManualEnabled: boolean('admin_manual_enabled').notNull().default(false),
    fired: boolean('fired').notNull().default(false),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    atLeastOneConditionCheck: check(
      'chk_target_based_at_least_one_condition',
      sql`${table.targetDate} IS NOT NULL OR ${table.targetAmountKobo} IS NOT NULL OR ${table.adminManualEnabled} = true`
    ),
  })
);

export type TargetBasedPayoutConfig = typeof targetBasedPayoutConfigs.$inferSelect;
export type NewTargetBasedPayoutConfig = typeof targetBasedPayoutConfigs.$inferInsert;
