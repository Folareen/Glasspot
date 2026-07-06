import { pgTable, uuid, text, bigint, integer, timestamp, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { transactions } from './transactions';

/**
 * The core object of the product — a group savings pool. No balance column; balance is always
 * derived from the ledger. status is one-way: draft (being configured, no contributions) -> open
 * (activated, payoutMode/refundType now immutable) -> closed (terminal, only reachable at zero
 * balance). payoutMode picks which *_payout_configs table (1:1 on potId) holds the actual rule.
 * Authorization isn't stored here — derived from potMembers.role='admin' at query time;
 * creatorId is historical only, no special authority. See potPendingOperationEnum below for the
 * in-flight payout/refund lock fields.
 */
export const potTypeEnum = pgEnum('pot_type', ['public', 'private']);
export const potStatusEnum = pgEnum('pot_status', ['draft', 'open', 'closed']);
export const payoutModeEnum = pgEnum('payout_mode', [
  'target_based',
  'manual',
  'recurring',
  'scheduled',
]);
export const refundTypeEnum = pgEnum('refund_type', ['admin', 'contributors']);
/**
 * Set while a payout/refund's outbound Nomba transfer(s) are in flight, blocking a second
 * payout/refund trigger from touching the same funds until all legs resolve ("money in flight is
 * tagged" rule). Does not change pot.status. pendingOperationLegCount tracks unresolved transfers
 * for the current operation: 1 for a normal payout/admin-refund (pendingOperationTransactionId
 * set), N for a contributors fan-out refund (one transaction per contributor,
 * pendingOperationTransactionId null since no single id represents the whole operation).
 * Decremented per resolved leg; the lock clears at 0.
 */
export const potPendingOperationEnum = pgEnum('pot_pending_operation', ['payout', 'refund']);

export const pots = pgTable(
  'pots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id').notNull().references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    potType: potTypeEnum('pot_type').notNull(),
    status: potStatusEnum('status').notNull().default('draft'),
    payoutMode: payoutModeEnum('payout_mode').notNull(),
    refundType: refundTypeEnum('refund_type').notNull(),
    shareSlug: text('share_slug').unique().notNull(),
    // Every amount/balance/goal field here is a kobo integer, no Kobo suffix (see system-rules.md).
    minContribution: bigint('min_contribution', { mode: 'bigint' })
      .notNull()
      .default(sql`10000`),
    maxContribution: bigint('max_contribution', { mode: 'bigint' }),
    // Optional, display-only fundraising goal for any payout mode — purely informational, never
    // read by trigger/payout logic. Distinct from target_based_payout_configs.targetAmount,
    // which actually fires a payout; the two can be set independently.
    goalAmount: bigint('goal_amount', { mode: 'bigint' }),
    pendingOperation: potPendingOperationEnum('pending_operation'),
    pendingOperationTransactionId: uuid('pending_operation_transaction_id').references(() => transactions.id),
    pendingOperationLegCount: integer('pending_operation_leg_count'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // FOR FUTURE REFERENCE (Milestone 6):
    // commentsEnabled: boolean('comments_enabled').notNull().default(true),
    // publicCommentPolicy: text('public_comment_policy'), // 'anyone' | 'contributors_only'
  },
  (table) => ({
    maxGeMinCheck: check(
      'chk_max_ge_min',
      sql`${table.maxContribution} IS NULL OR ${table.maxContribution} >= ${table.minContribution}`
    ),
  })
);

export type Pot = typeof pots.$inferSelect;
export type NewPot = typeof pots.$inferInsert;