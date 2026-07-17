import { eq } from "drizzle-orm";
import db, { recurringPayoutConfigs, scheduledPayoutLegs } from "@/db";
import { TargetBasedPayoutService } from "@/modules/pots/target-based-payout.service";
import type { DisbursementOnSuccess } from "./disbursement-job.types";

/**
 * Applies a disbursement job's declared side effect only after the transfer has actually
 * succeeded, so fired/nextRunAt state reflects reality, not just an attempt. Shared between
 * worker.ts's synchronous PENDING_BILLING-free success path and pots.service.ts's
 * resolvePendingTransfer (the async webhook-driven path for a transfer that was PENDING_BILLING at
 * send time) — both read this off the same persisted transaction row (transactions.onSuccess), not
 * off the BullMQ job payload, which the async path never sees again once the job returns.
 */
export async function applyOnSuccess(onSuccess: DisbursementOnSuccess): Promise<void> {
  switch (onSuccess.type) {
    case "mark_target_based_fired":
      // pendingOperation is already null and balance already 0 at this point (this runs after
      // releaseLock and a completed full-balance disbursement) — see applyFired's own comment for
      // why a targetDate config closes its pot here while a pure-amount config stays open.
      await TargetBasedPayoutService.applyFired(onSuccess.targetConfigId);
      return;

    case "advance_recurring_next_run_at": {
      // Re-read current nextRunAt/intervalDays rather than trusting a
      // value carried in the job payload from enqueue time — avoids
      // compounding drift if this config was somehow touched between
      // enqueue and this job actually running.
      const [config] = await db
        .select()
        .from(recurringPayoutConfigs)
        .where(eq(recurringPayoutConfigs.id, onSuccess.recurringConfigId));
      if (!config) return;
      const nextRunAt = new Date(config.nextRunAt.getTime() + config.intervalDays * 24 * 60 * 60 * 1000);
      await db.update(recurringPayoutConfigs).set({ nextRunAt }).where(eq(recurringPayoutConfigs.id, config.id));
      return;
    }

    case "mark_scheduled_leg_fired":
      await db
        .update(scheduledPayoutLegs)
        .set({ fired: true, firedAt: new Date() })
        .where(eq(scheduledPayoutLegs.id, onSuccess.scheduledLegId));
      return;
  }
}
