import { pgTable, uuid, text, bigint, integer, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for payoutMode='scheduled': a fixed, finite sequence of legs, each paying a fixed
 * amount to its own destination on its own scheduledDate, each firing once (e.g. ajo/esusu
 * rotating turns, or staged disbursements). ordered=true means strictly sequential (only the
 * lowest unfired sequenceOrder can fire); ordered=false means every leg fires independently on
 * its own date. No cycle/round column — indefinite repetition should use payoutMode='recurring'
 * instead. scheduledPayoutConfigs is one row per pot (the parent); scheduledPayoutLegs holds the
 * legs, sequenceOrder meaningful only when ordered=true. Set during 'draft', immutable once
 * 'open'.
 */
export const scheduledPayoutConfigs = pgTable('scheduled_payout_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .unique()
    .references(() => pots.id, { onDelete: 'cascade' }),
  ordered: boolean('ordered').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledPayoutLegs = pgTable(
  'scheduled_payout_legs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduledConfigId: uuid('scheduled_config_id')
      .notNull()
      .references(() => scheduledPayoutConfigs.id, { onDelete: 'cascade' }),
    sequenceOrder: integer('sequence_order').notNull(),
    destinationAccount: text('destination_account').notNull(),
    destinationBank: text('destination_bank').notNull(),
    /** account holder name resolved via Nomba's lookup at save time — see verifyAccountDetails() */
    destinationAccountName: text('destination_account_name').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    scheduledDate: timestamp('scheduled_date', { withTimezone: true }).notNull(),
    fired: boolean('fired').notNull().default(false),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scheduledConfigSequenceUnique: unique('scheduled_payout_legs_config_id_sequence_order_key').on(
      table.scheduledConfigId,
      table.sequenceOrder
    ),
  })
);

export type ScheduledPayoutConfig = typeof scheduledPayoutConfigs.$inferSelect;
export type NewScheduledPayoutConfig = typeof scheduledPayoutConfigs.$inferInsert;
export type ScheduledPayoutLeg = typeof scheduledPayoutLegs.$inferSelect;
export type NewScheduledPayoutLeg = typeof scheduledPayoutLegs.$inferInsert;
