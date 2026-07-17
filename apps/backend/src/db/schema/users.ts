import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

/**
 * Every registered person on Glasspot — credentials, identity, and (single-session setup) the
 * refresh token folded directly into the row. email/username are plain TEXT, so normalize casing
 * in the app layer. Refresh token reuse detection: on /auth/refresh, a hash match rotates the
 * token; a mismatch nulls it out immediately and kills the session.
 *
 * tokenVersion revokes already-issued ACCESS tokens (refreshTokenHash only ever covered the
 * refresh token) — embedded in every access token's payload at sign time (see
 * auth.service.ts's issueTokenPair), checked against this column's current value on every request
 * (see lib/plugins/jwt.ts's authenticate), and incremented at the same three points that already
 * null refreshTokenHash (logout, password reset, refresh-token reuse detected), so a stolen access
 * token stops working immediately instead of riding out its remaining 15-minute lifetime.
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
  tokenVersion: integer('token_version').notNull().default(0),

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