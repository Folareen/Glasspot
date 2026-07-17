import { pgTable, uuid, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * One-time codes gating a money-moving admin action (payout/refund trigger); contextHash binds a
 * code to the exact request body it was issued for, so it can't be replayed against a retry with
 * different parameters. consumedByIdempotencyKey records which Idempotency-Key request consumed
 * this code — a retry carrying that SAME key (e.g. after the enqueue step downstream of
 * verification threw a transient error) can then be recognized as already-verified instead of
 * failing with "No active confirmation code found," which the client has no way to satisfy since
 * the code was already burned on the first attempt. See ActionOtpService.verify.
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
  consumedByIdempotencyKey: text('consumed_by_idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ActionOtpCode = typeof actionOtpCodes.$inferSelect;
export type NewActionOtpCode = typeof actionOtpCodes.$inferInsert;
