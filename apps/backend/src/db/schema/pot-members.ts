import { pgTable, uuid, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';

/**
 * Membership + permissions for a pot: role='admin' can manage members, edit a draft pot, and
 * trigger payout/refund; 'member' cannot (any-admin threshold, no multi-approver quorum yet). No
 * 'creator' role — pots.creatorId carries no special authority, the creator is just inserted as
 * a regular admin. A pot must always keep at least one admin, enforced at the service layer.
 */
export const potMemberRoleEnum = pgEnum('pot_member_role', ['admin', 'member']);

export const potMembers = pgTable(
  'pot_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    potId: uuid('pot_id').notNull().references(() => pots.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: potMemberRoleEnum('role').notNull().default('member'),
    addedByUserId: uuid('added_by_user_id').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    potUserUnique: unique('pot_members_pot_id_user_id_key').on(table.potId, table.userId),
  })
);

export type PotMember = typeof potMembers.$inferSelect;
export type NewPotMember = typeof potMembers.$inferInsert;