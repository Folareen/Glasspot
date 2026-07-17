import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import db, {
  pots,
  recurringPayoutConfigs,
  scheduledPayoutConfigs,
  scheduledPayoutLegs,
  type Pot,
  type ScheduledPayoutLeg,
} from "@/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { OUTBOUND_FEE } from "@/lib/fees";
import { postFixedAmountDisbursement, decrementPendingOperationLeg } from "./pots.service";
import { TransferQueueService } from "../scheduler/transfer-queue.service";
import type { DisbursementJobData } from "../scheduler/disbursement-job.types";

/** Enqueues due recurring/scheduled payouts onto the `transfers` queue; "fired"/"skipped" mean enqueued/not-enqueued this sweep, not completed — the Nomba call and ledger completion happen later in the worker. */
export const PayoutSchedulerService = {
  /** Enqueues a fixed-amount payout for every OPEN pot's due recurring_payout_configs row; underfunded pots are skipped and logged, leaving nextRunAt unchanged so the occurrence retries. */
  async fireDueRecurringPayouts(): Promise<{ fired: number; skipped: number }> {
    // nextRunAt only advances once the worker confirms the transfer succeeded (advance_recurring_next_run_at), never at enqueue time.
    const due = await db
      .select({ config: recurringPayoutConfigs, pot: pots })
      .from(recurringPayoutConfigs)
      .innerJoin(pots, eq(pots.id, recurringPayoutConfigs.potId))
      .where(and(eq(pots.status, "open"), lte(recurringPayoutConfigs.nextRunAt, new Date())));

    let fired = 0;
    let skipped = 0;

    for (const { config, pot } of due) {
      const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
      const balance = await LedgerService.getBalance(potAccount.id);

      if (balance < config.amount + OUTBOUND_FEE) {
        console.warn(
          `Recurring payout for pot ${pot.id} due but underfunded (balance=${balance}, needs=${config.amount} plus the ₦50 outbound fee) — skipping, nextRunAt unchanged`
        );
        skipped++;
        continue;
      }

      try {
        await postFixedAmountDisbursement(
          pot,
          "payout",
          config.amount,
          { destinationAccount: config.destinationAccount, destinationBank: config.destinationBank },
          { type: "advance_recurring_next_run_at", recurringConfigId: config.id }
        );
        fired++;
      } catch (err) {
        // Enqueue itself failed (e.g. Redis unreachable) or the pot
        // already had another operation in flight — nextRunAt stays
        // unchanged either way, so this occurrence is retried next sweep.
        console.error(`Failed to enqueue recurring payout for pot ${pot.id}:`, err);
        skipped++;
      }
    }

    return { fired, skipped };
  },

  /** Enqueues due scheduled-payout legs per pot: if `ordered`, only the lowest-sequence unfired leg fires, blocking later legs until it succeeds (ajo/esusu rotation); otherwise every due unfired leg fires independently. */
  async fireDueScheduledLegs(): Promise<{ fired: number; skipped: number }> {
    // A leg only flips `fired` once the worker confirms its transfer succeeded (mark_scheduled_leg_fired), never at enqueue time.
    const openPots = await db
      .select({ config: scheduledPayoutConfigs, pot: pots })
      .from(scheduledPayoutConfigs)
      .innerJoin(pots, eq(pots.id, scheduledPayoutConfigs.potId))
      .where(eq(pots.status, "open"));

    let fired = 0;
    let skipped = 0;

    for (const { config, pot } of openPots) {
      if (config.ordered) {
        const [nextLeg] = await db
          .select()
          .from(scheduledPayoutLegs)
          .where(and(eq(scheduledPayoutLegs.scheduledConfigId, config.id), eq(scheduledPayoutLegs.fired, false)))
          .orderBy(asc(scheduledPayoutLegs.sequenceOrder))
          .limit(1);

        if (!nextLeg) continue; // every leg has fired.
        if (nextLeg.scheduledDate > new Date()) continue; // not due yet.

        const result = await enqueueLeg(pot, nextLeg);
        result === "fired" ? fired++ : skipped++;
        continue;
      }

      const dueLegs = await db
        .select()
        .from(scheduledPayoutLegs)
        .where(
          and(
            eq(scheduledPayoutLegs.scheduledConfigId, config.id),
            eq(scheduledPayoutLegs.fired, false),
            lte(scheduledPayoutLegs.scheduledDate, new Date())
          )
        )
        .orderBy(asc(scheduledPayoutLegs.sequenceOrder));

      if (dueLegs.length === 0) continue;

      const result = await enqueueUnorderedLegs(pot, dueLegs);
      fired += result.fired;
      skipped += result.skipped;
    }

    return { fired, skipped };
  },
};

/** Checks funding and enqueues one due leg's disbursement job — used by the `ordered` branch above, where only one leg is ever due at a time (the next unfired one in sequence), so it's fine to claim the pot's pendingOperation lock as a normal single-leg disbursement. */
async function enqueueLeg(pot: Pot, leg: ScheduledPayoutLeg): Promise<"fired" | "skipped"> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);

  if (balance < leg.amount + OUTBOUND_FEE) {
    console.warn(
      `Scheduled leg ${leg.id} (pot ${pot.id}, sequence ${leg.sequenceOrder}) due but underfunded (balance=${balance}, needs=${leg.amount} plus the ₦50 outbound fee) — skipping, leg stays unfired`
    );
    return "skipped";
  }

  try {
    await postFixedAmountDisbursement(
      pot,
      "payout",
      leg.amount,
      { destinationAccount: leg.destinationAccount, destinationBank: leg.destinationBank },
      { type: "mark_scheduled_leg_fired", scheduledLegId: leg.id }
    );
    return "fired";
  } catch (err) {
    console.error(`Failed to enqueue scheduled leg ${leg.id} for pot ${pot.id}:`, err);
    return "skipped";
  }
}

/**
 * Enqueues every due leg of an `unordered` scheduled config in one batch, sharing a single
 * pendingOperation lock (pendingOperationLegCount = number of legs actually admitted) instead of
 * each leg competing for its own exclusive claim — the same fan-out pattern postContributorsRefund
 * uses for refundType='contributors' (see that function's own pendingOperationLegCount +
 * isFanOutLeg comments). Without this, postFixedAmountDisbursement's single-leg claim meant only
 * the FIRST due leg in a sweep could ever win the lock; every other due leg in the same sweep
 * failed the claim and was counted "skipped," so N due legs took N separate daily sweeps to all
 * fire instead of firing together in one.
 *
 * Legs are admitted in sequenceOrder against a single balance snapshot (not rescaled/split like a
 * contributors refund's pro-rata shares — a scheduled leg's amount is fixed at config time) — a
 * leg only fires if the balance still covers its full amount + OUTBOUND_FEE after every
 * already-admitted leg ahead of it has reserved its own share; a leg that doesn't fit is skipped
 * (stays unfired) without blocking later, smaller, legs from being considered in the same pass.
 */
async function enqueueUnorderedLegs(pot: Pot, dueLegs: ScheduledPayoutLeg[]): Promise<{ fired: number; skipped: number }> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);

  const admitted: ScheduledPayoutLeg[] = [];
  let reserved = 0n;
  let skipped = 0;

  for (const leg of dueLegs) {
    if (balance - reserved < leg.amount + OUTBOUND_FEE) {
      console.warn(
        `Scheduled leg ${leg.id} (pot ${pot.id}, sequence ${leg.sequenceOrder}) due but underfunded after reserving earlier due legs (remaining=${balance - reserved}, needs=${leg.amount} plus the ₦50 outbound fee) — skipping, leg stays unfired`
      );
      skipped++;
      continue;
    }
    reserved += leg.amount + OUTBOUND_FEE;
    admitted.push(leg);
  }

  if (admitted.length === 0) {
    return { fired: 0, skipped };
  }

  // Claim the lock once for the whole batch — mirrors postContributorsRefund's
  // pendingOperationLegCount = legs.length claim, not postFixedAmountDisbursement's legCount: 1.
  const claimed = await db
    .update(pots)
    .set({ pendingOperation: "payout", pendingOperationLegCount: admitted.length })
    .where(and(eq(pots.id, pot.id), isNull(pots.pendingOperation)))
    .returning({ id: pots.id });

  if (claimed.length === 0) {
    // Some other operation (e.g. an admin-triggered refund) already holds the lock — every leg in
    // this batch stays unfired, retried next sweep, same as a single-leg claim failure today.
    console.error(`Failed to claim pendingOperation for pot ${pot.id}'s unordered scheduled legs — another operation is already in flight`);
    return { fired: 0, skipped: skipped + admitted.length };
  }

  let fired = 0;
  for (const leg of admitted) {
    const reference = `payout_${pot.id}_${leg.id}_${randomUUID()}`;
    const jobData: DisbursementJobData = {
      kind: "payout",
      potId: pot.id,
      amount: leg.amount.toString(),
      destinationAccount: leg.destinationAccount,
      destinationBank: leg.destinationBank,
      reference,
      isFanOutLeg: true,
      onSuccess: { type: "mark_scheduled_leg_fired", scheduledLegId: leg.id },
    };
    try {
      await TransferQueueService.enqueuePayout(jobData);
      fired++;
    } catch (err) {
      // Enqueue itself failed (e.g. Redis unreachable) — release this leg's share of the lock
      // rather than leaving it stranded waiting for a transfer job that was never created.
      console.error(`Failed to enqueue scheduled leg ${leg.id} for pot ${pot.id}:`, err);
      await decrementPendingOperationLeg(pot.id);
      skipped++;
    }
  }

  return { fired, skipped };
}
