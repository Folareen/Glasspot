import { and, eq, inArray, lt } from "drizzle-orm";
import db, { contributions, contributionPayments } from "@/db";
import { nomba } from "@/integrations/nomba";
import { TransferQueueService } from "../scheduler/transfer-queue.service";

/** Sweeps expired, underfunded virtual accounts: refunds each contribution_payments row to its own sender, marks the contribution 'failed', and releases the Nomba virtual account. Scheduled via CronSchedulerService's expiry-sweep cron entry. */
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
      const payments = await db
        .select()
        .from(contributionPayments)
        .where(and(eq(contributionPayments.contributionId, contribution.id), eq(contributionPayments.refunded, false)));

      let allEnqueuedOk = true;

      for (const payment of payments) {
        try {
          await TransferQueueService.enqueueContributionRefund({
            kind: "contribution_refund",
            contributionId: contribution.id,
            contributionPaymentId: payment.id,
            amount: payment.amount.toString(),
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
        await db.update(contributions).set({ status: "failed" }).where(eq(contributions.id, contribution.id));
        expiredCount++;
      }
      // else: left as pending/underpaid — still expired, still picked up
      // by the WHERE clause next sweep, so the unenqueued payment(s) get
      // another chance.
    }

    return { expiredContributions: expiredCount, refundedPayments };
  },
};