import { and, eq, gte, inArray, lte } from "drizzle-orm";
import db, {
  settlementBatches,
  reconciliationRecords,
  transactions,
  contributions,
  type SettlementBatch,
} from "@/db";
import { nomba } from "@/integrations/nomba";
import type { LocalPaymentRecord, ReconciliationLineItem, ReconciliationStatus } from "@/integrations/nomba/nomba.types";
import { isValidNairaString, koboToNairaString, nairaStringToKobo } from "@/lib/money";

/** Converts a Nomba-reported naira amount (a float, prone to representation error) to an exact kobo bigint, or undefined if unconvertible. */
function nombaNairaToKobo(amount: number | undefined): bigint | undefined {
  if (!Number.isFinite(amount)) return undefined;
  const negative = amount! < 0;
  // toFixed(2) is the one safe float touch here: rounding a genuine external currency value to
  // Nomba's own 2-decimal precision, before nairaStringToKobo's exact string-based conversion
  // takes over. Sign is peeled off first since nairaStringToKobo's regex only accepts unsigned
  // input but a reconciliation line (e.g. a reversal) can legitimately be negative.
  const fixed = Math.abs(amount!).toFixed(2);
  if (!isValidNairaString(fixed)) return undefined;
  const kobo = nairaStringToKobo(fixed);
  return negative ? -kobo : kobo;
}

/** A reconcile() line item's own status vocabulary doesn't map 1:1 onto reconciliation_records' — this is the single place that translates between them. */
function toRecordStatus(
  status: ReconciliationStatus
): "matched" | "unmatched_internal" | "unmatched_external" | "amount_mismatch" {
  switch (status) {
    case "matched":
      return "matched";
    case "orphan":
      return "unmatched_external";
    case "missing_on_nomba":
      return "unmatched_internal";
    case "overpaid":
    case "underpaid":
      return "amount_mismatch";
  }
}

// Wraps NombaClient.reconcile() with our own persistence: opens a settlement_batches row for the
// window, feeds it every transaction expected in that window, and writes one
// reconciliation_records row per finding. Provider's API state wins, per system-rules.md.
export const ReconciliationService = {
  /** Runs one reconciliation pass for [dateFrom, dateTo) against Nomba's transaction API; safe to re-run over the same window since each call creates a fresh batch + finding rows. */
  async runForWindow(dateFrom: Date, dateTo: Date): Promise<SettlementBatch> {
    // "Expected" means a transaction whose correlating ref should surface somewhere in Nomba's
    // own transaction list for this window — contribution (inbound funding), payout, and refund
    // (outbound transfers) all correlate 1:1 with a real Nomba-side call, but under DIFFERENT
    // fields: payout/refund report back merchantTxRef, which IS transactions.reference (see
    // worker.ts's callNomba, which passes data.reference as merchantTxRef) — but contribution
    // (inbound vact_transfer) reports back virtualAccountReference, which is
    // contributions.virtualAccountRef, a value generated independently of transactions.reference
    // (`contribution_${contribution.id}`) and never sent to Nomba. Joining through contributions
    // here (rather than comparing transactions.reference directly) is what makes inbound rows
    // matchable at all — see nomba.types.ts's Transaction doc comment.
    const expectedTransactions = await db
      .select({ id: transactions.id, reference: transactions.reference, type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          inArray(transactions.type, ["contribution", "payout", "refund"]),
          gte(transactions.createdAt, dateFrom),
          lte(transactions.createdAt, dateTo)
        )
      );

    const contributionRefsByTransactionId = new Map<string, string>();
    const contributionTransactionIds = expectedTransactions
      .filter((t) => t.type === "contribution")
      .map((t) => t.id);
    if (contributionTransactionIds.length > 0) {
      const rows = await db
        .select({ transactionId: contributions.transactionId, virtualAccountRef: contributions.virtualAccountRef })
        .from(contributions)
        .where(inArray(contributions.transactionId, contributionTransactionIds));
      for (const row of rows) {
        if (row.transactionId) contributionRefsByTransactionId.set(row.transactionId, row.virtualAccountRef);
      }
    }

    // The ref Nomba would actually report for this transaction: virtualAccountRef for
    // contributions, transactions.reference (== merchantTxRef) for payout/refund.
    const correlatingRefFor = (t: (typeof expectedTransactions)[number]): string =>
      t.type === "contribution" ? (contributionRefsByTransactionId.get(t.id) ?? t.reference) : t.reference;

    const expectedInWindow = expectedTransactions.map((t) => ({ ref: correlatingRefFor(t), amount: t.amount }));

    const [batch] = await db
      .insert(settlementBatches)
      .values({
        provider: "nomba",
        batchReference: `nomba_${dateFrom.toISOString()}_${dateTo.toISOString()}`,
        periodStart: dateFrom,
        periodEnd: dateTo,
        expectedAmount: expectedInWindow.reduce((sum, r) => sum + r.amount, 0n),
      })
      .returning();

    /** Resolves a Nomba correlatingRef (merchantTxRef or virtualAccountReference) back to the local transactions row it corresponds to, trying the direct reference first and falling back to a contributions join. */
    const findTransactionByRef = async (ref: string) => {
      const [direct] = await db.select().from(transactions).where(eq(transactions.reference, ref));
      if (direct) return direct;

      const [viaContribution] = await db
        .select({ transaction: transactions })
        .from(contributions)
        .innerJoin(transactions, eq(transactions.id, contributions.transactionId))
        .where(eq(contributions.virtualAccountRef, ref));
      return viaContribution?.transaction ?? null;
    };

    const report = await nomba.reconcile({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      status: "success",
      findLocalByRef: async (ref): Promise<LocalPaymentRecord | null> => {
        const transaction = await findTransactionByRef(ref);
        if (!transaction) return null;
        return { amount: Number(koboToNairaString(transaction.amount)) };
      },
      listExpectedRefs: async () => expectedInWindow.map((r) => r.ref),
      onLineItem: async (item: ReconciliationLineItem) => {
        const transaction = await findTransactionByRef(item.correlatingRef);

        // A null/undefined amount is expected (e.g. an orphan has no localAmount); an
        // unconvertible one degrades to "unknown" for this record rather than aborting the batch.
        await db.insert(reconciliationRecords).values({
          settlementBatchId: batch.id,
          transactionId: transaction?.id,
          externalReference: item.correlatingRef,
          internalAmount: nombaNairaToKobo(item.localAmount),
          externalAmount: nombaNairaToKobo(item.nombaAmount),
          status: toRecordStatus(item.status),
        });
      },
    });

    // Convert each line item to kobo individually then sum as bigint — summing the report's
    // float total first can drift by a kobo or more and produce false "mismatched" statuses.
    const reportedAmount = report.lineItems.reduce(
      (sum, item) => sum + (nombaNairaToKobo(item.nombaAmount) ?? 0n),
      0n
    );

    const allMatched =
      report.overpaidCount === 0 &&
      report.underpaidCount === 0 &&
      report.orphanCount === 0 &&
      report.missingOnNombaCount === 0;

    const [updated] = await db
      .update(settlementBatches)
      .set({ reportedAmount, status: allMatched ? "matched" : "mismatched" })
      .where(eq(settlementBatches.id, batch.id))
      .returning();

    return updated;
  },
};
