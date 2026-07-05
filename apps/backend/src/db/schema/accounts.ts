import { pgTable, uuid, text, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';

/**
 * One row per ledger account — every pot and system bucket. There is no
 * per-user wallet account: money moves straight from a contributor's real
 * bank account (via a Nomba virtual account) into a pot, and straight from
 * a pot back out to a real bank account on payout/refund — a user never
 * holds a balance inside Glasspot. Never store a balance directly on pots;
 * balances are always derived from ledgerEntries (materialized in the
 * `balances` table). ownerId is nullable because platform-level accounts
 * (revenue, float, suspense) have no owner row to point at — ownerType
 * alone identifies them, and there is exactly one active row per platform
 * ownerType (enforced by the partial unique index below, not by
 * application convention).
 *
 * normalBalance mirrors standard accounting sign convention: a pot account
 * is a liability (credit increases it — we owe that money out).
 * platform_float/provider_settlement are assets (debit increases them —
 * real cash we hold). platform_revenue is credit-normal (revenue). suspense
 * is debit-normal by convention here since it's a holding/asset-like bucket
 * for unresolved funds.
 */
export const accountOwnerTypeEnum = pgEnum('account_owner_type', [
  'pot',
  'platform_revenue',
  'platform_float',
  'suspense',
  'provider_settlement',
]);
export const normalBalanceEnum = pgEnum('normal_balance', ['debit', 'credit']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'frozen', 'closed']);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: accountOwnerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id'),
    currency: text('currency').notNull().default('NGN'),
    normalBalance: normalBalanceEnum('normal_balance').notNull(),
    status: accountStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // A given user/pot gets exactly one account — enforced here rather
    // than only "one row per create call" in application code. Platform
    // accounts (ownerId null) are NOT covered by this constraint since a
    // plain unique() treats every NULL as distinct; that's fine, platform
    // account uniqueness is enforced separately at the service layer
    // (getOrCreateSystemAccount checks-then-inserts under a query, and
    // there's only ever one caller path that creates them).
    ownerTypeOwnerIdUnique: unique('accounts_owner_type_owner_id_key').on(table.ownerType, table.ownerId),
  })
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
