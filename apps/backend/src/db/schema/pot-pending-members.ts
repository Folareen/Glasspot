import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

// A pot can accumulate multiple pending-member rows per email over time (e.g. removed then
// re-added), so uniqueness is scoped to only the 'pending' rows via a partial unique index —
// closes the check-then-insert race in PendingMembersService.create (two concurrent adds for the
// same pot+email both passing the pre-check) at the DB level instead of relying on app logic.
export const potPendingMembers = pgTable(
  'pot_pending_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: potMemberRoleEnum('role').notNull().default('member'),
    status: potPendingMemberStatusEnum('status').notNull().default('pending'),
    addedByUserId: uuid('added_by_user_id').notNull().references(() => users.id),
    joinedUserId: uuid('joined_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('pot_pending_members_pot_id_email_pending_key')
      .on(table.potId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ]
);

export type PotPendingMember = typeof potPendingMembers.$inferSelect;
export type NewPotPendingMember = typeof potPendingMembers.$inferInsert;
