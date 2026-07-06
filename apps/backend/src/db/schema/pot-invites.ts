import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';
import { potMemberRoleEnum } from './pot-members';

/**
 * A standing offer to join a pot, addressed by email rather than userId —
 * unlike pot_members (userId NOT NULL), this table exists precisely to
 * hold a placeholder for someone who isn't a Glasspot user yet.
 *
 * status:
 *   pending  - invite created, no matching user has verified this email yet.
 *   accepted - a user verified this exact email (see AuthService.verifyEmail)
 *              and was inserted into pot_members as a result. Terminal.
 *   cancelled - an admin revoked the invite before it was accepted. Terminal.
 *
 * If the email already belongs to a verified user at invite time, the
 * invite is accepted immediately (no pending period) — see
 * PotInvitesService.create. Email is matched case-insensitively (lower()
 * on both sides) since users.email has no case-folding at the DB level
 * (see users.ts comment).
 */
export const potInviteStatusEnum = pgEnum('pot_invite_status', ['pending', 'accepted', 'cancelled']);

// No table-level unique(potId, email): a pot can accumulate more than one
// invite row per email over time (e.g. cancel then re-invite), so
// "already has a pending invite" is a service-layer check (see
// PotInvitesService.create) against status='pending' specifically, not a
// DB constraint.
export const potInvites = pgTable('pot_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: potMemberRoleEnum('role').notNull().default('member'),
  status: potInviteStatusEnum('status').notNull().default('pending'),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id),
  acceptedUserId: uuid('accepted_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
});

export type PotInvite = typeof potInvites.$inferSelect;
export type NewPotInvite = typeof potInvites.$inferInsert;
