import { and, eq, inArray } from "drizzle-orm";
import { isUniqueViolation } from "@/lib/db-errors";
import db, {
  accounts,
  balances,
  ledgerEntries,
  transactions,
  type Account,
  type Transaction,
  type NewLedgerEntry,
} from "@glasspot/db";
import { DuplicateTransactionReferenceError, LedgerError, UnbalancedTransactionError } from "./ledger.errors";

export type LedgerEntryInput = {
  accountId: string;
  direction: "debit" | "credit";
  amountKobo: bigint;
};

export type PostTransactionInput = {
  type: Transaction["type"];
  reference: string;
  entries: LedgerEntryInput[];
  externalReference?: string;
  metadata?: unknown;
  status?: Transaction["status"];
};

/** Throws unless entries is non-empty and sum(debits) === sum(credits) — the one invariant that must never reach the DB violated. */
function assertBalanced(entries: LedgerEntryInput[]): void {
  if (entries.length === 0) {
    throw new LedgerError("A transaction must have at least one ledger entry");
  }
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const entry of entries) {
    if (entry.amountKobo <= 0n) {
      throw new LedgerError("Ledger entry amountKobo must be positive");
    }
    if (entry.direction === "debit") {
      debitTotal += entry.amountKobo;
    } else {
      creditTotal += entry.amountKobo;
    }
  }
  if (debitTotal !== creditTotal) {
    throw new UnbalancedTransactionError();
  }
}

/**
 * Locks `accountId`'s balance row (SELECT ... FOR UPDATE) inside the caller's
 * open DB transaction, applies one entry's effect on it, and returns the new
 * ledgerBalance — so concurrent postings against the same account (e.g. two
 * contributions hitting the same pot at once) serialize instead of racing
 * (see docs/system-rules.md's concurrency + locking requirement).
 *
 * Debit/credit sign is relative to the account's normalBalance: an entry in
 * the account's normal direction increases its balance, the opposite
 * direction decreases it (standard double-entry convention).
 */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyEntryToBalance(
  tx: DbTransaction,
  account: Account,
  entry: LedgerEntryInput
): Promise<bigint> {
  const [lockedBalance] = await tx
    .select()
    .from(balances)
    .where(eq(balances.accountId, account.id))
    .for("update");

  const current = lockedBalance?.ledgerBalance ?? 0n;
  const signedDelta = entry.direction === account.normalBalance ? entry.amountKobo : -entry.amountKobo;
  const next = current + signedDelta;

  if (lockedBalance) {
    await tx
      .update(balances)
      .set({ ledgerBalance: next, availableBalance: next, version: lockedBalance.version + 1, updatedAt: new Date() })
      .where(eq(balances.accountId, account.id));
  } else {
    await tx.insert(balances).values({ accountId: account.id, ledgerBalance: next, availableBalance: next });
  }

  return next;
}

export const LedgerService = {
  /**
   * The only way money ever moves (see docs/system-rules.md). Validates
   * debits==credits, then in a single DB transaction: inserts the
   * transactions row, locks + updates each affected account's balance, and
   * inserts one immutable ledgerEntries row per entry with its
   * post-entry balanceAfter snapshot. Whole thing rolls back on any
   * failure — never partially posted.
   *
   * Idempotent by `reference`: if a transaction with this reference
   * already exists, returns it as-is instead of re-posting — safe for a
   * caller to retry the exact same logical operation twice.
   *
   * `executor` defaults to `db` but accepts an already-open transaction —
   * reverseTransaction() passes its own tx so the reversal posting and its
   * subsequent status update commit atomically together (see that
   * method's comment).
   */
  async postTransaction(input: PostTransactionInput, executor: typeof db | DbTransaction = db): Promise<Transaction> {
    assertBalanced(input.entries);

    const [existing] = await executor.select().from(transactions).where(eq(transactions.reference, input.reference));
    if (existing) {
      return existing;
    }

    const accountIds = [...new Set(input.entries.map((e) => e.accountId))];

    try {
      return await executor.transaction(async (tx) => {
        const affectedAccounts = await tx.select().from(accounts).where(inArray(accounts.id, accountIds));
        const accountsById = new Map(affectedAccounts.map((a) => [a.id, a]));
        for (const id of accountIds) {
          if (!accountsById.has(id)) {
            throw new LedgerError(`Account '${id}' does not exist`);
          }
        }

        let created: Transaction;
        try {
          [created] = await tx
            .insert(transactions)
            .values({
              type: input.type,
              status: input.status ?? "completed",
              reference: input.reference,
              externalReference: input.externalReference,
              amountKobo: input.entries.filter((e) => e.direction === "debit").reduce((sum, e) => sum + e.amountKobo, 0n),
              metadata: input.metadata,
              completedAt: input.status === undefined || input.status === "completed" ? new Date() : undefined,
            })
            .returning();
        } catch (err) {
          // Unique violation on `reference` — a concurrent caller won the
          // race to post the same idempotency key between our existence
          // check above and this insert.
          if (isUniqueViolation(err)) {
            throw new DuplicateTransactionReferenceError(input.reference);
          }
          throw err;
        }

        // Locks are acquired in this iteration's order, so it must follow the
        // sorted accountIds order above, not input.entries' caller-supplied
        // order — see accountIds' comment for why.
        const sortedEntries = [...input.entries].sort((a, b) => a.accountId.localeCompare(b.accountId));

        const entryRows: NewLedgerEntry[] = [];
        for (const entry of sortedEntries) {
          const account = accountsById.get(entry.accountId)!;
          const balanceAfter = await applyEntryToBalance(tx, account, entry);
          entryRows.push({
            transactionId: created.id,
            accountId: entry.accountId,
            direction: entry.direction,
            amountKobo: entry.amountKobo,
            balanceAfter,
          });
        }

        await tx.insert(ledgerEntries).values(entryRows);

        return created;
      });
    } catch (err) {
      // The concurrent-loser path promised by this method's docstring: a
      // caller that raced another to the same reference and lost gets the
      // winner's row back, not a thrown error to handle specially.
      if (err instanceof DuplicateTransactionReferenceError) {
        const [existing] = await executor.select().from(transactions).where(eq(transactions.reference, input.reference));
        if (existing) return existing;
      }
      throw err;
    }
  },

  /** Current ledgerBalance for an account, or 0n if no balance row exists yet (an account with no postings). */
  async getBalance(accountId: string): Promise<bigint> {
    const [row] = await db.select().from(balances).where(eq(balances.accountId, accountId));
    return row?.ledgerBalance ?? 0n;
  },

  /**
   * Posts a brand-new transaction with every original entry's direction
   * flipped, referencing the original transaction's id in metadata. Never
   * edits or deletes the original entries — reversal is forward-only (see
   * docs/system-rules.md). `reference` must be a fresh idempotency key
   * distinct from the original transaction's.
   */
  async reverseTransaction(originalTransactionId: string, reference: string): Promise<Transaction> {
    const [original] = await db.select().from(transactions).where(eq(transactions.id, originalTransactionId));
    if (!original) {
      throw new LedgerError(`Transaction '${originalTransactionId}' does not exist`, 404);
    }

    const originalEntries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, originalTransactionId));

    const reversedEntries: LedgerEntryInput[] = originalEntries.map((e) => ({
      accountId: e.accountId,
      direction: e.direction === "debit" ? "credit" : "debit",
      amountKobo: e.amountKobo,
    }));

    // postTransaction opens its own db.transaction internally; the status
    // update below must land in the same commit as that internal
    // transaction, not as a separate statement afterward — otherwise a
    // crash between the two leaves the reversing entries durably posted
    // (money correct) but the original transaction's status stuck at
    // 'completed' instead of 'reversed'.
    return db.transaction(async (tx) => {
      const transaction = await this.postTransaction(
        {
          type: "reversal",
          reference,
          entries: reversedEntries,
          metadata: { reversalOf: originalTransactionId },
        },
        tx
      );

      await tx.update(transactions).set({ status: "reversed" }).where(eq(transactions.id, originalTransactionId));

      return transaction;
    });
  },

  /**
   * Marks a 'processing' transaction 'completed' — used when an external
   * call that was left in-flight (e.g. a Nomba transfer returning
   * PENDING_BILLING) later resolves successfully via webhook. Does not
   * touch ledgerEntries or balances, which were already applied when the
   * transaction was first posted.
   */
  async markCompleted(transactionId: string): Promise<Transaction> {
    const [updated] = await db
      .update(transactions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(transactions.id, transactionId))
      .returning();
    if (!updated) {
      throw new LedgerError(`Transaction '${transactionId}' does not exist`, 404);
    }
    return updated;
  },
};
