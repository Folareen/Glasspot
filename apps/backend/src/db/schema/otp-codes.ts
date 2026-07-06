import { pgTable, uuid, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

/** One-time codes for auth (signup email verification, login 2nd factor) — not for money-action approvals, see action-otp-codes.ts for that. */
export const otpPurposeEnum = pgEnum('otp_purpose', [
  'signup_verification',
  'login',
  'password_reset',
]);

export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: otpPurposeEnum('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Consider a composite index on (user_id, purpose, consumed_at) if query patterns need it.

export type OtpCode = typeof otpCodes.$inferSelect;
export type NewOtpCode = typeof otpCodes.$inferInsert;