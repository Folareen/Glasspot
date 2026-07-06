import { and, asc, eq, lte } from "drizzle-orm";
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
import { postFixedAmountDisbursement } from "./pots.service";

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

      if (balance < config.amount) {
        console.warn(
          `Recurring payout for pot ${pot.id} due but underfunded (balance=${balance}, needs=${config.amount}) — skipping, nextRunAt unchanged`
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

      for (const leg of dueLegs) {
        const result = await enqueueLeg(pot, leg);
        result === "fired" ? fired++ : skipped++;
      }
    }

    return { fired, skipped };
  },
};

/** Checks funding and enqueues one due leg's disbursement job. Shared by both the ordered and unordered enqueue paths above. */
async function enqueueLeg(pot: Pot, leg: ScheduledPayoutLeg): Promise<"fired" | "skipped"> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);

  if (balance < leg.amount) {
    console.warn(
      `Scheduled leg ${leg.id} (pot ${pot.id}, sequence ${leg.sequenceOrder}) due but underfunded (balance=${balance}, needs=${leg.amount}) — skipping, leg stays unfired`
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
