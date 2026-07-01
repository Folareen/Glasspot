import { pgTable, uuid, bigint, text, boolean, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots.js';

/**
 * Configured rules deciding when/how money can leave a pot on the "locked"
 * side. A pot can have several — e.g. one firing automatically at a target
 * amount, another waiting on a specific person's manual go-ahead. This
 * table only stores the RULE; nothing here executes a transfer yet
 * (execution logic is Milestone 2).
 *
 * config shape by type:
 *   target_reached      -> {}  (fires once contributions hit amountKobo)
 *   date_reached        -> { date: "2026-08-01T00:00:00Z" }
 *   organizer_decision  -> { eligibility: "creator" | "specific", memberIds: [...] }
 *       "creator-only payout"    = eligibility: 'creator'
 *       "assigned member payout" = eligibility: 'specific'
 *       ("approval rules" for multiple eligible approvers needs a threshold
 *        field here later — not needed today, single-approver/creator-only only)
 */
export const payoutTriggerTypeEnum = pgEnum('payout_trigger_type', [
  'target_reached',
  'date_reached',
  'organizer_decision',
]);

export const payoutTriggers = pgTable('payout_triggers', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
  type: payoutTriggerTypeEnum('type').notNull(),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  destinationAccount: text('destination_account').notNull(),
  destinationBank: text('destination_bank').notNull(),
  config: jsonb('config').notNull(),
  fired: boolean('fired').notNull().default(false),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // FOR FUTURE REFERENCE (Milestone 2):
  // A `payoutTriggerApprovals` table/file will be needed once organizer_decision
  // triggers support multiple eligible approvers who each sign off individually.
});

export type PayoutTrigger = typeof payoutTriggers.$inferSelect;
export type NewPayoutTrigger = typeof payoutTriggers.$inferInsert;