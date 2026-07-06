import { pgTable, uuid, text, bigint, integer, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for a pot with payoutMode = 'scheduled' — a sequence of
 * legs, each paying a fixed amount to its own destination on its own
 * scheduledDate, each firing exactly once. The same destination can repeat
 * across legs and amounts can differ per leg — e.g. ajo/esusu-style
 * rotating turns (each member gets one turn), or staged/installment
 * disbursements (the same or different destinations paid in stages).
 *
 * ordered controls firing behavior:
 *   true  - strictly sequential: only the lowest sequenceOrder unfired leg
 *           can fire, even if a later leg's own scheduledDate has also
 *           passed (ajo/esusu rotation semantics — "leg 2 cannot fire
 *           before leg 1").
 *   false - independent: every unfired leg fires on its own scheduledDate
 *           regardless of whether earlier legs have fired yet (staged
 *           disbursement semantics — e.g. pay vendor A Monday, vendor B
 *           Tuesday, with no dependency between them).
 *
 * Always a fixed, finite list of legs that completes once every leg has
 * fired — no cycle/round column exists to support indefinite repetition.
 * A pot that needs to keep paying out on an ongoing interval should use
 * payoutMode = 'recurring' instead.
 *
 * scheduledPayoutConfigs: one row per pot (potId unique), just the parent.
 * scheduledPayoutLegs: the legs themselves, sequenceOrder starting at 0 or
 * 1 (pick one convention at implementation time) — meaningful only when
 * ordered=true, but always stored so a pot can flip the ordered flag
 * without needing to re-enter every leg.
 *
 * Set once while the pot is 'draft' and immutable once the pot is 'open' —
 * see pots.ts status semantics.
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
