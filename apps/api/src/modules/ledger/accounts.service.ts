import { and, eq, isNull } from "drizzle-orm";
import db, { accounts, type Account } from "@glasspot/db";

/** owner_type <-> normal_balance pairing, see accounts.ts schema comment for the accounting rationale per type. */
const NORMAL_BALANCE_BY_OWNER_TYPE: Record<Account["ownerType"], Account["normalBalance"]> = {
  pot: "credit",
  platform_revenue: "credit",
  platform_float: "debit",
  provider_settlement: "debit",
  suspense: "debit",
};

async function getOrCreateAccount(ownerType: Account["ownerType"], ownerId: string | null): Promise<Account> {
  const whereOwnerId = ownerId === null ? isNull(accounts.ownerId) : eq(accounts.ownerId, ownerId);
  const [existing] = await db.select().from(accounts).where(and(eq(accounts.ownerType, ownerType), whereOwnerId));
  if (existing) {
    return existing;
  }

  try {
    const [created] = await db
      .insert(accounts)
      .values({ ownerType, ownerId: ownerId ?? undefined, normalBalance: NORMAL_BALANCE_BY_OWNER_TYPE[ownerType] })
      .returning();
    return created;
  } catch (err) {
    // Unique violation on (owner_type, owner_id) — a concurrent caller
    // already created this account between our check and this insert.
    // Postgres error code 23505. Re-select rather than treat as fatal.
    if ((err as { code?: string }).code === "23505") {
      const [row] = await db.select().from(accounts).where(and(eq(accounts.ownerType, ownerType), whereOwnerId));
      if (row) return row;
    }
    throw err;
  }
}

export const AccountsService = {
  /** The one account for a pot — created lazily on first use. */
  async getOrCreatePotAccount(potId: string): Promise<Account> {
    return getOrCreateAccount("pot", potId);
  },

  /**
   * Platform-level system accounts (revenue, float, suspense,
   * provider_settlement) have no ownerId — there is exactly one active row
   * per ownerType across the whole system, not one per something else.
   */
  async getOrCreateSystemAccount(
    ownerType: Extract<Account["ownerType"], "platform_revenue" | "platform_float" | "suspense" | "provider_settlement">
  ): Promise<Account> {
    return getOrCreateAccount(ownerType, null);
  },
};
