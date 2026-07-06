import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import db, {
  settlementBatches,
  reconciliationRecords,
  transactions,
  type SettlementBatch,
} from "@/db";
import { nomba } from "@/integrations/nomba";
import type { LocalPaymentRecord, ReconciliationLineItem, ReconciliationStatus } from "@/integrations/nomba/nomba.types";
import { koboToNairaString, nairaStringToKobo } from "@/lib/money";

/**
 * Converts a Nomba-reported naira amount (a native JS number, prone to
 * float representation error, e.g. 19.1 * 100 !== 1910) back to an exact
 * kobo bigint. toFixed(2) is the one safe place to touch a naira float in
 * this codebase — it's rounding a genuine currency value Nomba itself
 * returned (never a value we're constructing), to the same 2-decimal
 * precision Nomba's own API represents money in — then the naira/kobo
 * split-and-combine in nairaStringToKobo takes over so no further float
 * arithmetic touches the result.
 */
function nombaNairaToKobo(amount: number): bigint {
  return nairaStringToKobo(amount.toFixed(2));
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

/**
 * Wraps NombaClient.reconcile() with our own persistence: opens a
 * settlement_batches row for the window, feeds it every transaction we
 * expected in that window (matched by reference == Nomba's merchantTxRef,
 * per docs/system-rules.md's "provider's API state wins" principle), and
 * writes one reconciliation_records row per finding.
 */
export const ReconciliationService = {
  /**
   * Runs one reconciliation pass for [dateFrom, dateTo) against Nomba's
   * transaction API, covering every local transaction posted in the
   * window that has an externalReference (contributions confirmed via
   * webhook, and payout/refund transfers). Idempotent to re-run over the
   * same window — creates a fresh batch + fresh finding rows each call
   * rather than mutating a prior run's, per reconciliation-records.ts's
   * append-only design.
   */
  async runForWindow(dateFrom: Date, dateTo: Date): Promise<SettlementBatch> {
    const expectedInWindow = await db
      .select({ reference: transactions.reference, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          isNotNull(transactions.externalReference),
          gte(transactions.createdAt, dateFrom),
          lte(transactions.createdAt, dateTo)
        )
      );

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

    const report = await nomba.reconcile({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      status: "success",
      findLocalByRef: async (merchantTxRef): Promise<LocalPaymentRecord | null> => {
        const [transaction] = await db.select().from(transactions).where(eq(transactions.reference, merchantTxRef));
        if (!transaction) return null;
        return { amount: Number(koboToNairaString(transaction.amount)) };
      },
      listExpectedRefs: async () => expectedInWindow.map((r) => r.reference),
      onLineItem: async (item: ReconciliationLineItem) => {
        const [transaction] = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reference, item.merchantTxRef));

        // Number.isFinite guards against nombaNairaToKobo(NaN) throwing (a
        // malformed naira string fails isValidNairaString) and aborting the
        // whole reconciliation batch over one bad line item — a
        // null/undefined amount is expected (e.g. an orphan has no
        // localAmount), but NaN/Infinity should degrade to "unknown" for
        // this one record rather than blow up the run.
        await db.insert(reconciliationRecords).values({
          settlementBatchId: batch.id,
          transactionId: transaction?.id,
          externalReference: item.merchantTxRef,
          internalAmount: Number.isFinite(item.localAmount) ? nombaNairaToKobo(item.localAmount!) : undefined,
          externalAmount: Number.isFinite(item.nombaAmount) ? nombaNairaToKobo(item.nombaAmount!) : undefined,
          status: toRecordStatus(item.status),
        });
      },
    });

    // Convert each line item's naira amount to kobo individually, then sum
    // as BigInt — summing report.byCustomer[].receivedTotal (a JS float
    // accumulated across every transaction in the window before converting)
    // can drift from the true integer-kobo total by a kobo or more and
    // produce false "mismatched" statuses. Number.isFinite guards the same
    // NaN/Infinity edge case as the per-line-item insert above.
    const reportedAmount = report.lineItems.reduce(
      (sum, item) => sum + (Number.isFinite(item.nombaAmount) ? nombaNairaToKobo(item.nombaAmount!) : 0n),
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
