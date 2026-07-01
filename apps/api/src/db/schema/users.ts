import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Every registered person on Glasspot. Holds login credentials, identity,
 * and — for today's simplified single-session setup — the refresh token
 * itself, folded directly into the row instead of a separate table.
 *
 * email/username stored as plain TEXT — normalize casing in the app layer
 * before insert/lookup if case-insensitivity matters.
 *
 * Refresh token reuse detection: on /auth/refresh, compare the presented
 * token's hash to refreshTokenHash. Match -> rotate (overwrite hash +
 * expiry). Mismatch -> null this out immediately, kill the session.
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

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // FOR FUTURE REFERENCE (not needed today):
  // avatarUrl: text('avatar_url'),
  // defaultRefundAccount: text('default_refund_account'),
  // defaultRefundBank: text('default_refund_bank'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;