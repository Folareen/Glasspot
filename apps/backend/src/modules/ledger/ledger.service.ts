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
} from "@/db";
import { DuplicateTransactionReferenceError, LedgerError, UnbalancedTransactionError } from "./ledger.errors";

export type LedgerEntryInput = {
  accountId: string;
  direction: "debit" | "credit";
  amount: bigint;
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
    if (entry.amount <= 0n) {
      throw new LedgerError("Ledger entry amount must be positive");
    }
    if (entry.direction === "debit") {
      debitTotal += entry.amount;
    } else {
      creditTotal += entry.amount;
    }
  }
  if (debitTotal !== creditTotal) {
    throw new UnbalancedTransactionError();
  }
}

/** Locks accountId's balance row (SELECT ... FOR UPDATE) in the caller's open transaction, applies one entry, and returns the new ledgerBalance — serializes concurrent postings against the same account. */
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
  // Sign relative to the account's normalBalance: an entry in the account's normal
  // direction increases its balance, the opposite direction decreases it.
  const signedDelta = entry.direction === account.normalBalance ? entry.amount : -entry.amount;
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
   * The only way money ever moves: validates debits==credits, then atomically inserts the
   * transaction row, locks + updates each affected account's balance, and inserts one immutable
   * ledgerEntries row per entry. Idempotent by `reference` — an existing transaction with the
   * same reference is returned as-is rather than re-posted.
   */
  // executor defaults to `db` but accepts an already-open transaction — reverseTransaction()
  // passes its own tx so the reversal posting and its status update commit atomically together.
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
              amount: input.entries.filter((e) => e.direction === "debit").reduce((sum, e) => sum + e.amount, 0n),
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
            amount: entry.amount,
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

  /** Posts a new transaction with every original entry's direction flipped; never edits/deletes the original — reversal is forward-only. `reference` must be a fresh idempotency key. */
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
      amount: e.amount,
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

  /** Marks a 'processing' transaction 'completed' once an in-flight external call resolves via webhook; does not touch ledgerEntries/balances, already applied at posting time. */
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
