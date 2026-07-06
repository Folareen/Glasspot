import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Every registered person on Glasspot — credentials, identity, and (single-session setup) the
 * refresh token folded directly into the row. email/username are plain TEXT, so normalize casing
 * in the app layer. Refresh token reuse detection: on /auth/refresh, a hash match rotates the
 * token; a mismatch nulls it out immediately and kills the session.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),

  refreshTokenHash: text('refresh_token_hash'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),

  // Destination for a refundType='admin' pot's refund transfer to whoever triggers it. Nullable
  // at signup; PotsService.triggerRefund throws if unset when actually needed.
  defaultRefundAccount: text('default_refund_account'),
  defaultRefundBank: text('default_refund_bank'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // FOR FUTURE REFERENCE (not needed today):
  // avatarUrl: text('avatar_url'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;