import { pgTable, uuid, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * One-time codes used at two points in the auth flow: verifying a new
 * signup's email, and the second factor after password login. Each row is
 * a single code tied to one user and one purpose, with its own attempt
 * counter and expiry.
 *
 * Not used for money-action approvals — see action-otp-codes.ts's
 * actionOtpCodes table for that, bound to {userId, action, potId,
 * contextHash} rather than just "valid code for this user".
 */
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

// index.ts / migration note: add a composite index on (user_id, purpose, consumed_at)
// via drizzle-kit's `index()` helper if query patterns need it — omitted here since
// Drizzle's declarative index syntax varies by version; add in the table's third
// argument callback: (table) => ({ userPurposeIdx: index('idx_otp_user_purpose').on(table.userId, table.purpose, table.consumedAt) })

export type OtpCode = typeof otpCodes.$inferSelect;
export type NewOtpCode = typeof otpCodes.$inferInsert;