import { and, asc, eq, lte } from "drizzle-orm";
import db, {
  pots,
  recurringPayoutConfigs,
  scheduledPayoutConfigs,
  scheduledPayoutLegs,
  type Pot,
  type RecurringPayoutConfig,
  type ScheduledPayoutLeg,
} from "@/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { postFixedAmountDisbursement } from "./pots.service";

/**
 * Fires due recurring/scheduled payouts (see recurring-payout-configs.ts
 * and scheduled-payout-configs.ts). No scheduler exists yet in this build
 * (BullMQ deferred) — invoked via apps/backend/src/scripts/fire-payouts.ts
 * until one does, same pattern as ReconciliationService/ExpiryService.
 */
export const PayoutSchedulerService = {
  /**
   * For every OPEN pot's recurring_payout_configs row with nextRunAt due:
   * fires a fixed-amountKobo payout and advances nextRunAt by
   * intervalDays on success/PENDING_BILLING. If the pot's balance is
   * below amountKobo, per recurring-payout-configs.ts's own documented
   * intent: skip this run, leave nextRunAt UNCHANGED (the occurrence
   * must be satisfied before it advances), and surface via logging — not
   * a silent drop (see docs/system-rules.md).
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

      if (balance < config.amountKobo) {
        console.warn(
          `Recurring payout for pot ${pot.id} due but underfunded (balance=${balance}, needs=${config.amountKobo}) — skipping, nextRunAt unchanged`
        );
        skipped++;
        continue;
      }

      try {
        await postFixedAmountDisbursement(pot, "payout", config.amountKobo, {
          destinationAccount: config.destinationAccount,
          destinationBank: config.destinationBank,
        });
        await advanceNextRunAt(config);
        fired++;
      } catch (err) {
        // A rejected/failed transfer already reversed its own ledger leg
        // inside postFixedAmountDisbursement — nextRunAt intentionally
        // NOT advanced, so this occurrence is retried next sweep rather
        // than silently skipped forever.
        console.error(`Recurring payout failed for pot ${pot.id}:`, err);
        skipped++;
      }
    }

    return { fired, skipped };
  },

  /**
   * For every OPEN pot's scheduled payout config, fires due legs according
   * to that pot's own `ordered` flag (see scheduled-payout-configs.ts):
   *
   * ordered=true (ajo/esusu rotation semantics): fires only the LOWEST
   * sequenceOrder unfired leg once its scheduledDate is due — never a
   * later leg while an earlier one is still unfired ("leg 2 cannot fire
   * before leg 1"), even if the later leg's own scheduledDate has also
   * passed. A stuck leg blocks the rest of that pot's legs from
   * progressing until it succeeds, surfaced via logging each sweep.
   *
   * ordered=false (staged/installment disbursement semantics): fires
   * EVERY unfired leg whose own scheduledDate is due, independently —
   * one leg failing or not yet being due has no bearing on any other leg
   * of the same pot.
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

        const result = await fireLeg(pot, nextLeg);
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
        const result = await fireLeg(pot, leg);
        result === "fired" ? fired++ : skipped++;
      }
    }

    return { fired, skipped };
  },
};

/** Attempts to fire one due leg — checks funding, disburses, and marks it fired on success. Shared by both the ordered and unordered firing paths above. */
async function fireLeg(pot: Pot, leg: ScheduledPayoutLeg): Promise<"fired" | "skipped"> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);

  if (balance < leg.amountKobo) {
    console.warn(
      `Scheduled leg ${leg.id} (pot ${pot.id}, sequence ${leg.sequenceOrder}) due but underfunded (balance=${balance}, needs=${leg.amountKobo}) — skipping, leg stays unfired`
    );
    return "skipped";
  }

  try {
    await postFixedAmountDisbursement(pot, "payout", leg.amountKobo, {
      destinationAccount: leg.destinationAccount,
      destinationBank: leg.destinationBank,
    });
    await markLegFired(leg);
    return "fired";
  } catch (err) {
    console.error(`Scheduled leg ${leg.id} failed for pot ${pot.id}:`, err);
    return "skipped";
  }
}

/** Advances a recurring payout config's nextRunAt by intervalDays — only called after that occurrence's disbursement has actually succeeded/gone PENDING_BILLING. */
async function advanceNextRunAt(config: RecurringPayoutConfig): Promise<void> {
  const nextRunAt = new Date(config.nextRunAt.getTime() + config.intervalDays * 24 * 60 * 60 * 1000);
  await db.update(recurringPayoutConfigs).set({ nextRunAt }).where(eq(recurringPayoutConfigs.id, config.id));
}

/** Marks a scheduled leg fired — only called after that leg's disbursement has actually succeeded/gone PENDING_BILLING. */
async function markLegFired(leg: ScheduledPayoutLeg): Promise<void> {
  await db.update(scheduledPayoutLegs).set({ fired: true, firedAt: new Date() }).where(eq(scheduledPayoutLegs.id, leg.id));
}
