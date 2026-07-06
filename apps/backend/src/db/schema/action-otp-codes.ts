import { pgTable, uuid, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * One-time codes gating a money-moving admin action on a pot (manual
 * payout trigger, admin refund trigger) — the action_otp_codes table
 * otp-codes.ts anticipated. Bound to {userId, action, potId, contextHash}
 * rather than just "valid code for this user": contextHash locks the code
 * to the exact request body (e.g. destination/amount) it was requested
 * for, so a code issued for one payout can't be replayed against a retry
 * with different parameters.
 */
export const actionOtpActionEnum = pgEnum('action_otp_action', [
  'trigger_payout',
  'trigger_refund',
]);

export const actionOtpCodes = pgTable('action_otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: actionOtpActionEnum('action').notNull(),
  potId: uuid('pot_id').notNull(),
  contextHash: text('context_hash').notNull(),
  codeHash: text('code_hash').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ActionOtpCode = typeof actionOtpCodes.$inferSelect;
export type NewActionOtpCode = typeof actionOtpCodes.$inferInsert;
