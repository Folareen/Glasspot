import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';
import { potMemberRoleEnum } from './pot-members';

/**
 * Someone an admin has added to a pot by email, addressed by email rather than userId, because
 * they aren't a Glasspot user yet — not an invite the recipient can accept or decline, they're
 * already added; this row just tracks that they'll become a real pot_members row automatically
 * the moment they verify their email. status: pending (unverified email) -> joined (a user
 * verified this email and was inserted into pot_members, terminal) or removed (admin revoked
 * before they signed up, terminal). If the email already belongs to a verified user, the row is
 * skipped entirely and they're inserted into pot_members immediately. Matched case-insensitively
 * since users.email has no DB-level case-folding.
 */
export const potPendingMemberStatusEnum = pgEnum('pot_pending_member_status', ['pending', 'joined', 'removed']);

// No table-level unique(potId, email) — a pot can accumulate multiple pending-member rows per
// email over time; "already has a pending row" is a service-layer check, not a DB constraint.
export const potPendingMembers = pgTable('pot_pending_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: potMemberRoleEnum('role').notNull().default('member'),
  status: potPendingMemberStatusEnum('status').notNull().default('pending'),
  addedByUserId: uuid('added_by_user_id').notNull().references(() => users.id),
  joinedUserId: uuid('joined_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  joinedAt: timestamp('joined_at', { withTimezone: true }),
});

export type PotPendingMember = typeof potPendingMembers.$inferSelect;
export type NewPotPendingMember = typeof potPendingMembers.$inferInsert;
