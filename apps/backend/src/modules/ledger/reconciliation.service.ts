import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import db, {
  settlementBatches,
  reconciliationRecords,
  transactions,
  type SettlementBatch,
} from "@/db";
import { nomba } from "@/integrations/nomba";
import type { LocalPaymentRecord, ReconciliationLineItem, ReconciliationStatus } from "@/integrations/nomba/nomba.types";
import { isValidNairaString, koboToNairaString, nairaStringToKobo } from "@/lib/money";

/**
 * Converts a Nomba-reported naira amount (a native JS number, prone to
 * float representation error, e.g. 19.1 * 100 !== 1910) back to an exact
 * kobo bigint, or undefined if the value can't be represented as one.
 * toFixed(2) is the one safe place to touch a naira float in this
 * codebase — it's rounding a genuine currency value Nomba itself returned
 * (never a value we're constructing), to the same 2-decimal precision
 * Nomba's own API represents money in — then the naira/kobo split-and-
 * combine in nairaStringToKobo takes over so no further float arithmetic
 * touches the result.
 *
 * Takes `number | undefined` directly (matching ReconciliationLineItem's
 * optional localAmount/nombaAmount) and returns undefined for anything it
 * can't convert — missing, NaN/Infinity, or a magnitude toFixed(2) can't
 * render as "digits.digits" (e.g. scientific notation) — so every call
 * site degrades that one record to "unknown" instead of throwing.
 *
 * nairaStringToKobo's regex has no sign group (every other call site in
 * this codebase runs on a value already validated by the nairaAmount
 * zod/AJV schema, which only ever accepts a positive wire amount), but a
 * reconciliation line item is untrusted external data and a negative
 * figure is a real, legitimate case here (e.g. a reversal/adjustment row)
 * — so the sign is peeled off and reapplied around the unsigned
 * conversion rather than rejected.
 */
function nombaNairaToKobo(amount: number | undefined): bigint | undefined {
  if (!Number.isFinite(amount)) return undefined;
  const negative = amount! < 0;
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

        // nombaNairaToKobo returns undefined for anything it can't convert
        // (missing, NaN/Infinity, or an unrepresentable magnitude) instead
        // of throwing — a null/undefined amount is expected (e.g. an
        // orphan has no localAmount), and a bad one degrades to "unknown"
        // for this one record rather than blowing up the whole batch.
        await db.insert(reconciliationRecords).values({
          settlementBatchId: batch.id,
          transactionId: transaction?.id,
          externalReference: item.merchantTxRef,
          internalAmount: nombaNairaToKobo(item.localAmount),
          externalAmount: nombaNairaToKobo(item.nombaAmount),
          status: toRecordStatus(item.status),
        });
      },
    });

    // Convert each line item's naira amount to kobo individually, then sum
    // as BigInt — summing report.byCustomer[].receivedTotal (a JS float
    // accumulated across every transaction in the window before converting)
    // can drift from the true integer-kobo total by a kobo or more and
    // produce false "mismatched" statuses. nombaNairaToKobo returning
    // undefined (missing/NaN/unrepresentable) degrades that one item's
    // contribution to 0 rather than aborting the whole sum, same as the
    // per-line-item insert above.
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
