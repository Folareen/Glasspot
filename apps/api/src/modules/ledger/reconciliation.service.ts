import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import db, {
  settlementBatches,
  reconciliationRecords,
  transactions,
  type SettlementBatch,
} from "@glasspot/db";
import { nomba } from "@/integrations/nomba";
import type { LocalPaymentRecord, ReconciliationLineItem, ReconciliationStatus } from "@/integrations/nomba/nomba.types";

/** Nomba amounts are naira; our ledger is kobo integers (docs/system-rules.md) — this module converts at the boundary only, never storing/comparing a float against a kobo value directly. */
function koboToNaira(amountKobo: bigint): number {
  return Number(amountKobo) / 100;
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
      .select({ reference: transactions.reference, amountKobo: transactions.amountKobo })
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
        expectedAmountKobo: expectedInWindow.reduce((sum, r) => sum + r.amountKobo, 0n),
      })
      .returning();

    const report = await nomba.reconcile({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      status: "success",
      findLocalByRef: async (merchantTxRef): Promise<LocalPaymentRecord | null> => {
        const [transaction] = await db.select().from(transactions).where(eq(transactions.reference, merchantTxRef));
        if (!transaction) return null;
        return { amount: koboToNaira(transaction.amountKobo) };
      },
      listExpectedRefs: async () => expectedInWindow.map((r) => r.reference),
      onLineItem: async (item: ReconciliationLineItem) => {
        const [transaction] = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reference, item.merchantTxRef));

        await db.insert(reconciliationRecords).values({
          settlementBatchId: batch.id,
          transactionId: transaction?.id,
          externalReference: item.merchantTxRef,
          internalAmountKobo: item.localAmount != null ? BigInt(Math.round(item.localAmount * 100)) : undefined,
          externalAmountKobo: item.nombaAmount != null ? BigInt(Math.round(item.nombaAmount * 100)) : undefined,
          status: toRecordStatus(item.status),
        });
      },
    });

    const reportedAmountKobo = BigInt(
      Math.round(report.byCustomer.reduce((sum, c) => sum + c.receivedTotal, 0) * 100)
    );
    const allMatched =
      report.overpaidCount === 0 &&
      report.underpaidCount === 0 &&
      report.orphanCount === 0 &&
      report.missingOnNombaCount === 0;

    const [updated] = await db
      .update(settlementBatches)
      .set({ reportedAmountKobo, status: allMatched ? "matched" : "mismatched" })
      .where(eq(settlementBatches.id, batch.id))
      .returning();

    return updated;
  },
};
