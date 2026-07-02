import { pgTable, uuid, text, bigint, integer, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for a pot with payoutMode = 'rotation' (ajo/esusu-style) — a
 * strictly ORDERED sequence of legs, each paying a fixed amount to its own
 * destination on its own scheduled date, each firing exactly once. Each
 * recipient gets one turn (destinations aren't expected to repeat).
 *
 * Contrast with payoutMode = 'scheduled' (see scheduled-payout-configs.ts):
 * scheduled entries are an unordered set — no sequenceOrder, no dependency
 * between entries, and the same destination CAN appear more than once
 * (e.g. pay vendor A twice on two different dates). Rotation's legs are
 * order-dependent and one-turn-per-recipient; scheduled's are not.
 *
 * rotationPayoutConfigs: one row per pot (potId unique), just the parent.
 * rotationPayoutLegs: the ordered legs themselves, sequenceOrder starting
 * at 0 or 1 (pick one convention at implementation time).
 *
 * Set once while the pot is 'draft' and immutable once the pot is 'open' —
 * see pots.ts status semantics.
 *
 * OPEN QUESTIONS (not yet decided — flagging rather than guessing):
 * 1. Does the sequence repeat after the last leg fires, or is it always a
 *    fixed finite list that completes once? Currently modeled as one-shot
 *    (no repeat) — no cycle/round column exists to support looping.
 * 2. Are leg amounts fixed by the creator upfront (current model,
 *    amountKobo NOT NULL per leg), or could a leg instead be
 *    "whatever the balance is at that date"? If the latter is needed,
 *    amountKobo would need to become nullable with a documented meaning.
 */
export const rotationPayoutConfigs = pgTable('rotation_payout_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .unique()
    .references(() => pots.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rotationPayoutLegs = pgTable(
  'rotation_payout_legs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rotationConfigId: uuid('rotation_config_id')
      .notNull()
      .references(() => rotationPayoutConfigs.id, { onDelete: 'cascade' }),
    sequenceOrder: integer('sequence_order').notNull(),
    destinationAccount: text('destination_account').notNull(),
    destinationBank: text('destination_bank').notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    scheduledDate: timestamp('scheduled_date', { withTimezone: true }).notNull(),
    fired: boolean('fired').notNull().default(false),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rotationConfigSequenceUnique: unique('rotation_payout_legs_config_id_sequence_order_key').on(
      table.rotationConfigId,
      table.sequenceOrder
    ),
  })
);

export type RotationPayoutConfig = typeof rotationPayoutConfigs.$inferSelect;
export type NewRotationPayoutConfig = typeof rotationPayoutConfigs.$inferInsert;
export type RotationPayoutLeg = typeof rotationPayoutLegs.$inferSelect;
export type NewRotationPayoutLeg = typeof rotationPayoutLegs.$inferInsert;
