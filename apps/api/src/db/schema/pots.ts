import { pgTable, uuid, text, bigint, timestamp, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * The core object of the product — a group savings pool. Stores what it's
 * called, public/private visibility, whether its payout mechanism is
 * locked (rule-based), flexible (any-authorized-member), or both, and its
 * lifecycle status. Deliberately has NO balance column — balance is always
 * computed from the ledger later (Milestone 2), never stored here.
 *
 * Flexible-authorization eligibility is NOT stored on this table — who can
 * act on a 'flexible'/'both' pot is derived at query time from
 * potMembers.role (creator/admin can act alone; plain 'member' cannot).
 * See pot-members.ts.
 */
export const potTypeEnum = pgEnum('pot_type', ['public', 'private']);
export const lockModeEnum = pgEnum('lock_mode', ['locked', 'flexible', 'both']);
export const potStatusEnum = pgEnum('pot_status', ['ACTIVE', 'CLOSED', 'CANCELLED']);

export const pots = pgTable(
  'pots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id').notNull().references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    potType: potTypeEnum('pot_type').notNull(),
    lockMode: lockModeEnum('lock_mode').notNull(),
    status: potStatusEnum('status').notNull().default('ACTIVE'),
    shareSlug: text('share_slug').unique().notNull(),
    minContributionKobo: bigint('min_contribution_kobo', { mode: 'bigint' })
      .notNull()
      .default(sql`10000`),
    maxContributionKobo: bigint('max_contribution_kobo', { mode: 'bigint' }),
    contributionCloseAt: timestamp('contribution_close_at', { withTimezone: true }),
    rulesLockedAt: timestamp('rules_locked_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // FOR FUTURE REFERENCE (Milestone 6):
    // commentsEnabled: boolean('comments_enabled').notNull().default(true),
    // publicCommentPolicy: text('public_comment_policy'), // 'anyone' | 'contributors_only'
  },
  (table) => ({
    maxGeMinCheck: check(
      'chk_max_ge_min',
      sql`${table.maxContributionKobo} IS NULL OR ${table.maxContributionKobo} >= ${table.minContributionKobo}`
    ),
  })
);

export type Pot = typeof pots.$inferSelect;
export type NewPot = typeof pots.$inferInsert;