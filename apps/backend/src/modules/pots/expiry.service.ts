import { and, eq, inArray, lt } from "drizzle-orm";
import db, { contributions, contributionPayments } from "@/db";
import { nomba } from "@/integrations/nomba";
import { OUTBOUND_FEE } from "@/lib/fees";
import { TransferQueueService } from "../scheduler/transfer-queue.service";

/** Sweeps expired, underfunded virtual accounts: refunds each contribution_payments row to its own sender (minus the flat ₦50 outbound fee, same as every other outbound transfer), marks the contribution 'failed', and releases the Nomba virtual account. Scheduled via CronSchedulerService's expiry-sweep cron entry. */
export const ExpiryService = {
  /** Runs one sweep pass, enqueueing a contribution-refund job per unrefunded payment through the transfers queue rather than calling Nomba directly. */
  async sweepExpiredContributions(): Promise<{ expiredContributions: number; refundedPayments: number }> {
    // A contribution is only marked 'failed' once ALL its payments are successfully enqueued — if any enqueue
    // fails, it stays pending/underpaid so the next sweep retries rather than stranding an unqueued payment.
    // "refundedPayments" below means "enqueued," not "money moved" — completion happens async in the worker.
    const expired = await db
      .select()
      .from(contributions)
      .where(and(inArray(contributions.status, ["pending", "underpaid"]), lt(contributions.expiresAt, new Date())));

    let expiredCount = 0;
    let refundedPayments = 0;

    for (const contribution of expired) {
      // Re-check status atomically right before acting, rather than trusting the read at the top
      // of this loop — a payment_success webhook can fund this contribution (see
      // ContributionsService.confirmFunding) in the gap between that read and here, pushing its
      // status to 'funded'. Claiming it now (flip straight to 'failed', matching this sweep's
      // outcome, and only flip back if enqueueing fails below) closes that gap: whichever of this
      // sweep or a concurrent confirmFunding wins the race is decided by this one atomic UPDATE,
      // not by two independent reads days-of-code apart making conflicting decisions off stale
      // data. If confirmFunding already won (status is 'funded'), this claims 0 rows and the
      // contribution is skipped entirely — its payments are real funding now, not expiry refunds.
      const [claimed] = await db
        .update(contributions)
        .set({ status: "failed" })
        .where(and(eq(contributions.id, contribution.id), inArray(contributions.status, ["pending", "underpaid"])))
        .returning({ id: contributions.id });

      if (!claimed) {
        // Lost the race to a concurrent confirmFunding — leave it alone entirely.
        continue;
      }

      const payments = await db
        .select()
        .from(contributionPayments)
        .where(and(eq(contributionPayments.contributionId, contribution.id), eq(contributionPayments.refunded, false)));

      let allEnqueuedOk = true;

      for (const payment of payments) {
        // Fee-bearing like every other outbound transfer (system-rules.md) — the sender receives
        // payment.amount - OUTBOUND_FEE, never the raw amount. A payment too small to cover the
        // fee is left unrefunded (refunded stays false) rather than sending it at a loss, same as
        // confirmFunding's own "excess doesn't even cover the outbound fee" case.
        if (payment.amount <= OUTBOUND_FEE) {
          console.warn(
            `Expiry refund for payment ${payment.id} (amount=${payment.amount}) does not cover the ₦50 outbound fee — leaving unrefunded`
          );
          continue;
        }

        const refundAmount = payment.amount - OUTBOUND_FEE;

        try {
          await TransferQueueService.enqueueContributionRefund({
            kind: "contribution_refund",
            contributionId: contribution.id,
            contributionPaymentId: payment.id,
            amount: refundAmount.toString(),
            destinationAccount: payment.senderAccountNumber,
            destinationBank: payment.senderBankCode,
            reference: `expiry_refund_${payment.id}`,
          });
          refundedPayments++;
        } catch (err) {
          console.error(`Failed to enqueue expiry refund for payment ${payment.id}:`, err);
          allEnqueuedOk = false;
        }
      }

      // Best-effort, same as before: a failed Nomba virtual-account
      // release shouldn't block anything below it.
      try {
        await nomba.expireVirtualAccount(contribution.virtualAccountRef);
      } catch (err) {
        console.error(
          `Failed to release Nomba virtual account for contribution ${contribution.id} (ref ${contribution.virtualAccountRef}):`,
          err
        );
      }

      if (allEnqueuedOk) {
        expiredCount++;
      } else {
        // Roll the claim back to whichever of pending/underpaid this contribution actually was
        // (not a hardcoded guess — a never-paid contribution is 'pending', not 'underpaid') so the
        // next sweep's WHERE clause still picks it up and the unenqueued payment(s) get another try.
        await db.update(contributions).set({ status: contribution.status }).where(eq(contributions.id, contribution.id));
      }
    }

    return { expiredContributions: expiredCount, refundedPayments };
  },
};