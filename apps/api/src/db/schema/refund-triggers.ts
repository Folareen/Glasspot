import { pgTable, uuid, bigint, boolean, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots.js';

/**
 * Mirror of payoutTriggers for the "give the money back" path — configures
 * when contributors get refunded and who's allowed to authorize it. Same
 * principle: this records the rule, not the execution (Milestone 4 handles
 * actually moving money back).
 *
 * config shape by type:
 *   deadline_unmet   -> { date: "..." }  (auto-fires if target not hit by this date)
 *   member_approval  -> { eligibility: "creator" | "everyone" | "specific", memberIds: [...] }
 *       "organizer refund mode"   = eligibility: 'creator'
 *       "contributor refund mode" = eligibility: 'everyone' or 'specific'
 */
export const refundTriggerTypeEnum = pgEnum('refund_trigger_type', [
  'deadline_unmet',
  'member_approval',
]);

export const refundTriggers = pgTable('refund_triggers', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
  type: refundTriggerTypeEnum('type').notNull(),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  config: jsonb('config').notNull(),
  fired: boolean('fired').notNull().default(false),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // FOR FUTURE REFERENCE (Milestone 4):
  // A `refundTriggerApprovals` table/file will be needed once member_approval
  // triggers support multiple eligible approvers.
});

export type RefundTrigger = typeof refundTriggers.$inferSelect;
export type NewRefundTrigger = typeof refundTriggers.$inferInsert;