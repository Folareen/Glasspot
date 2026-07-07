import { pgTable, uuid, text, bigint, boolean, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pots } from './pots';

/**
 * Payout rule for payoutMode='target_based': fires once to a single destination when targetDate
 * OR targetAmount is met (at least one must be set, enforced below). No admin-manual-trigger
 * option — that's manual mode's job now; this fires exclusively via
 * TargetBasedPayoutService's cron sweep. One row per pot, set during 'draft', immutable once
 * 'open'.
 *
 * This payout mode always disburses the pot's full balance (see pots.service.ts's
 * postDisbursement), which nets the flat ₦50 outbound fee out of that balance rather than
 * adding it on top — so the group must set targetAmount inclusive of that eventual fee; the
 * actual payout the destination receives is targetAmount minus ₦50, not targetAmount itself.
 * See apps/backend/src/lib/fees.ts.
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
    /** account holder name resolved via Nomba's lookup at save time — see verifyAccountDetails() */
    destinationAccountName: text('destination_account_name').notNull(),
    targetDate: timestamp('target_date', { withTimezone: true }),
    targetAmount: bigint('target_amount', { mode: 'bigint' }),
    fired: boolean('fired').notNull().default(false),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    atLeastOneConditionCheck: check(
      'chk_target_based_at_least_one_condition',
      sql`${table.targetDate} IS NOT NULL OR ${table.targetAmount} IS NOT NULL`
    ),
  })
);

export type TargetBasedPayoutConfig = typeof targetBasedPayoutConfigs.$inferSelect;
export type NewTargetBasedPayoutConfig = typeof targetBasedPayoutConfigs.$inferInsert;
