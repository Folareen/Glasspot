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

/**
 * Enqueues due recurring/scheduled payouts (see recurring-payout-configs.ts
 * and scheduled-payout-configs.ts) onto the `transfers` queue — the actual
 * Nomba call and ledger completion happen later, in worker.ts, once the
 * job reaches the front of the queue. "fired"/"skipped" below mean
 * "successfully enqueued this sweep" / "not enqueued this sweep," not
 * "completed" — completion is now async (see postFixedAmountDisbursement).
 */
export const PayoutSchedulerService = {
  /**
   * For every OPEN pot's recurring_payout_configs row with nextRunAt due:
   * enqueues a fixed-amount payout. nextRunAt only advances once the
   * WORKER confirms the transfer actually succeeded (see
   * advance_recurring_next_run_at in worker.ts) — NOT at enqueue time. If
   * the pot's balance is below amount, per recurring-payout-configs.ts's
   * own documented intent: skip this run, leave nextRunAt UNCHANGED (the
   * occurrence must be satisfied before it advances), and surface via
   * logging — not a silent drop (see docs/system-rules.md).
   */
  async fireDueRecurringPayouts(): Promise<{ fired: number; skipped: number }> {
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

  /**
   * For every OPEN pot's scheduled payout config, enqueues due legs
   * according to that pot's own `ordered` flag (see
   * scheduled-payout-configs.ts):
   *
   * ordered=true (ajo/esusu rotation semantics): enqueues only the LOWEST
   * sequenceOrder unfired leg once its scheduledDate is due — never a
   * later leg while an earlier one is still unfired ("leg 2 cannot fire
   * before leg 1"), even if the later leg's own scheduledDate has also
   * passed. A stuck leg blocks the rest of that pot's legs from
   * progressing until it succeeds, surfaced via logging each sweep.
   *
   * ordered=false (staged/installment disbursement semantics): enqueues
   * EVERY unfired leg whose own scheduledDate is due, independently —
   * one leg failing or not yet being due has no bearing on any other leg
   * of the same pot.
   *
   * A leg only flips `fired` once the WORKER confirms its transfer
   * actually succeeded (see mark_scheduled_leg_fired in worker.ts) — not
   * at enqueue time.
   */
  async fireDueScheduledLegs(): Promise<{ fired: number; skipped: number }> {
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
