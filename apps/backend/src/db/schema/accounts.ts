import { pgTable, uuid, text, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';

/**
 * One row per ledger account (every pot + system bucket) — there's no per-user wallet; money
 * moves directly between a contributor/payee's real bank account and a pot. normalBalance
 * follows standard accounting sign convention: pot accounts and platform_revenue are
 * credit-normal (liabilities/revenue), platform_float/provider_settlement/suspense are
 * debit-normal (assets). ownerId is nullable for platform-level accounts, identified by
 * ownerType alone (one active row per platform ownerType, enforced by the unique index below).
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
    // Enforces one account per user/pot; doesn't cover platform accounts (ownerId null,
    // since unique() treats NULLs as distinct) — that uniqueness is handled in
    // getOrCreateSystemAccount instead.
    ownerTypeOwnerIdUnique: unique('accounts_owner_type_owner_id_key').on(table.ownerType, table.ownerId),
  })
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
