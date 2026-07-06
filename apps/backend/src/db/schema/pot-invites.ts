import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';
import { potMemberRoleEnum } from './pot-members';

/**
 * A standing offer to join a pot, addressed by email rather than userId, for someone who isn't
 * a Glasspot user yet. status: pending (unverified email) -> accepted (a user verified this
 * email and was inserted into pot_members, terminal) or cancelled (admin revoked, terminal). If
 * the email already belongs to a verified user, the invite is accepted immediately. Matched
 * case-insensitively since users.email has no DB-level case-folding.
 */
export const potInviteStatusEnum = pgEnum('pot_invite_status', ['pending', 'accepted', 'cancelled']);

// No table-level unique(potId, email) — a pot can accumulate multiple invite rows per email
// over time; "already has a pending invite" is a service-layer check, not a DB constraint.
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
