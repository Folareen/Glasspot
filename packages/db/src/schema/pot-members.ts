import { pgTable, uuid, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { pots } from './pots';
import { users } from './users';

/**
 * The membership + permissions layer for a pot — who belongs to it and
 * what role they hold. Every "can this user see/manage this pot" check
 * joins against this, and it's ALSO what decides flexible-action
 * eligibility: role IN ('creator', 'admin') can act alone on a
 * 'flexible'/'both' pot; a plain 'member' cannot. "Any" threshold only —
 * no multi-approver quorum logic yet.
 */
export const potMemberRoleEnum = pgEnum('pot_member_role', ['creator', 'admin', 'member']);

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