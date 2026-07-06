import { and, eq, inArray, lt } from "drizzle-orm";
import db, { contributions, contributionPayments } from "@/db";
import { nomba } from "@/integrations/nomba";
import { TransferQueueService } from "../scheduler/transfer-queue.service";

/**
 * Sweeps virtual accounts whose funding window has closed without
 * reaching expectedAmount (see contributions.ts's expiresAt/status
 * comments). For each: refunds every recorded contribution_payments row
 * individually to ITS OWN sender (not a single lump sum — two different
 * people may have each partially funded the same virtual account, and
 * each gets exactly what they sent back), marks the contribution
 * 'failed', and releases the virtual account on Nomba's side so it stops
 * counting against that contributor's 2-account cap.
 *
 * Scheduled via CronSchedulerService's expiry-sweep cron entry, running in
 * worker.ts's payoutCronWorker.
 */
export const ExpiryService = {
  /**
   * Runs one sweep pass. Enqueues a contribution-refund job per
   * unrefunded payment rather than calling Nomba directly — routes
   * through the same rate-limited transfers queue as every other
   * disbursement. A contribution is only marked 'failed' once ALL of
   * its payments were successfully HANDED OFF to the queue — if any
   * enqueue call fails (e.g. Redis unreachable), the contribution stays
   * pending/underpaid so the NEXT sweep retries the whole thing, rather
   * than silently stranding a payment that never got a job created for
   * it. "refundedPayments" below means "successfully enqueued," not
   * "money has moved" — actual completion happens async in the worker.
   */
  async sweepExpiredContributions(): Promise<{ expiredContributions: number; refundedPayments: number }> {
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