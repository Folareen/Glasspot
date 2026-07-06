import { pgTable, uuid, text, bigint, integer, timestamp, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { transactions } from './transactions';

/**
 * The core object of the product — a group savings pool. Stores what it's
 * called, public/private type, which payout mode governs how money leaves
 * it, which refund type drains it if payout isn't what closes it, and its
 * lifecycle status. Deliberately has NO balance column — balance is always
 * computed from the ledger later (Milestone 2), never stored here.
 *
 * status: draft -> open -> closed, one-way.
 *   draft  - being configured, nothing below is locked in yet, no contributions.
 *   open   - activated; payoutMode/refundType are now immutable for the pot's
 *            remaining lifetime. Reached from draft via an explicit activate action.
 *   closed - terminal, irreversible. Only reachable once balance is zero.
 *
 * payoutMode picks which *_payout_configs table (1:1 on potId) holds the
 * actual rule — see target-based/manual/recurring/scheduled-payout-configs.ts.
 *
 * Authorization is NOT stored on this table — who can act (e.g. edit a
 * draft, manage members, trigger a manual payout) is derived at query
 * time from potMembers.role = 'admin'. creatorId below is historical
 * record only and carries no special authority — see pot-members.ts.
 *
 * pendingOperation/pendingOperationTransactionId/pendingOperationLegCount:
 * see potPendingOperationEnum comment below — tracks an in-flight
 * payout/refund disbursement without introducing a new pot.status value.
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
 * Set while a payout/refund's outbound Nomba transfer(s) are in flight
 * (internal ledger leg(s) already posted, disbursement call(s) made or
 * PENDING_BILLING) — blocks a second payout/refund trigger from touching
 * the same funds until every in-flight transfer resolves (see
 * docs/system-rules.md's "money in flight is tagged" rule). Pot stays
 * status='open' throughout; this is deliberately NOT a pot.status value —
 * see pots.ts status semantics above, which this does not change.
 *
 * pendingOperationLegCount is how many independent outbound transfers are
 * still unresolved for the current operation — 1 for a normal
 * single-destination payout/admin-refund (pendingOperationTransactionId
 * points at that one transaction), N for a refundType='contributors'
 * fan-out refund (one independent ledger transaction + transfer per
 * contributor — pendingOperationTransactionId is null in that case, since
 * no single transaction id represents the whole operation; each leg's own
 * transaction is found via its metadata.potId + status='processing').
 * Decremented by one each time resolvePendingTransfer resolves one leg;
 * the pendingOperation lock only clears once it reaches 0.
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
    // Every amount/balance/goal field in this schema is a kobo integer —
    // see docs/system-rules.md's money rule. No Kobo suffix on any of them.
    minContribution: bigint('min_contribution', { mode: 'bigint' })
      .notNull()
      .default(sql`10000`),
    maxContribution: bigint('max_contribution', { mode: 'bigint' }),
    // Optional, display-only fundraising goal for ANY payout mode — purely
    // informational ("raised X of Y"), never read by any trigger/payout
    // logic. Distinct from target_based_payout_configs.targetAmount,
    // which actually FIRES a payout once reached; a target_based pot can
    // set both independently (e.g. a public goal of ₦200k shown to
    // contributors, while the real trigger amount is configured
    // separately, or left unset since payout might instead be date-driven).
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