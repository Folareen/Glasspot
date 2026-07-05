import { pgTable, uuid, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';

/**
 * The membership + permissions layer for a pot — who belongs to it and
 * what role they hold. Every "can this user see/manage this pot" check
 * joins against this, and it's ALSO what decides authority: role = 'admin'
 * can manage members, edit a draft pot, and trigger payout/refund; a plain
 * 'member' cannot. "Any" threshold only — no multi-approver quorum yet.
 *
 * No 'creator' role — pots.creatorId is historical record only, carrying
 * no special authority. The creator is inserted here as role='admin' on
 * pot creation, same as any other admin, and can be demoted to 'member' or
 * removed entirely by another admin. A pot must always keep at least one
 * admin — enforced at the service layer, not the DB, since it depends on
 * counting sibling rows.
 */
export const potMemberRoleEnum = pgEnum('pot_member_role', ['admin', 'member']);

export const potMembers = pgTable(
  'pot_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: potMemberRoleEnum('role').notNull().default('member'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    potUserUnique: unique('pot_members_pot_id_user_id_key').on(table.potId, table.userId),
  })
);

export type PotMember = typeof potMembers.$inferSelect;
export type NewPotMember = typeof potMembers.$inferInsert;