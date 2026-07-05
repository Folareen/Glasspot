import { and, asc, eq, lte } from "drizzle-orm";
import db, {
  pots,
  recurringPayoutConfigs,
  rotationPayoutConfigs,
  rotationPayoutLegs,
  type RecurringPayoutConfig,
  type RotationPayoutLeg,
} from "@glasspot/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { postFixedAmountDisbursement } from "./pots.service";

/**
 * Fires due recurring/rotation payouts (see recurring-payout-configs.ts
 * and rotation-payout-configs.ts). No scheduler exists yet in this build
 * (BullMQ deferred) — invoked via apps/api/src/scripts/fire-payouts.ts
 * until one does, same pattern as ReconciliationService/ExpiryService.
 */

// export const PayoutSchedulerService = {
//   /**
//    * For every OPEN pot's recurring_payout_configs row with nextRunAt due:
//    * fires a fixed-amountKobo payout and advances nextRunAt by
//    * intervalDays on success/PENDING_BILLING. If the pot's balance is
//    * below amountKobo, per recurring-payout-configs.ts's own documented
//    * intent: skip this run, leave nextRunAt UNCHANGED (the occurrence
//    * must be satisfied before it advances), and surface via logging — not
//    * a silent drop (see docs/system-rules.md).
//    */
//   async fireDueRecurringPayouts(): Promise<{ fired: number; skipped: number }> {
//     const due = await db
//       .select({ config: recurringPayoutConfigs, pot: pots })
//       .from(recurringPayoutConfigs)
//       .innerJoin(pots, eq(pots.id, recurringPayoutConfigs.potId))
//       .where(and(eq(pots.status, "open"), lte(recurringPayoutConfigs.nextRunAt, new Date())));

//     let fired = 0;
//     let skipped = 0;

//     for (const { config, pot } of due) {
//       const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
//       const balance = await LedgerService.getBalance(potAccount.id);

//       if (balance < config.amountKobo) {
//         console.warn(
//           `Recurring payout for pot ${pot.id} due but underfunded (balance=${balance}, needs=${config.amountKobo}) — skipping, nextRunAt unchanged`
//         );
//         skipped++;
//         continue;
//       }

//       try {
//         await postFixedAmountDisbursement(pot, "payout", config.amountKobo, {
//           destinationAccount: config.destinationAccount,
//           destinationBank: config.destinationBank,
//         });
//         await advanceNextRunAt(config);
//         fired++;
//       } catch (err) {
//         // A rejected/failed transfer already reversed its own ledger leg
//         // inside postFixedAmountDisbursement — nextRunAt intentionally
//         // NOT advanced, so this occurrence is retried next sweep rather
//         // than silently skipped forever.
//         console.error(`Recurring payout failed for pot ${pot.id}:`, err);
//         skipped++;
//       }
//     }

//     return { fired, skipped };
//   },

//   /**
//    * For every OPEN pot's rotation, fires only the LOWEST sequenceOrder
//    * unfired leg once its scheduledDate is due — never a later leg while
//    * an earlier one is still unfired (rotation-payout-configs.ts: "leg 2
//    * cannot fire before leg 1"), even if the later leg's own scheduledDate
//    * has also passed. A stuck leg blocks the whole rotation from
//    * progressing until it succeeds, surfaced via logging each sweep.
//    */
//   async fireDueRotationLegs(): Promise<{ fired: number; skipped: number }> {
//     const openPots = await db
//       .select({ config: rotationPayoutConfigs, pot: pots })
//       .from(rotationPayoutConfigs)
//       .innerJoin(pots, eq(pots.id, rotationPayoutConfigs.potId))
//       .where(eq(pots.status, "open"));

//     let fired = 0;
//     let skipped = 0;

//     for (const { config, pot } of openPots) {
//       const [nextLeg] = await db
//         .select()
//         .from(rotationPayoutLegs)
//         .where(and(eq(rotationPayoutLegs.rotationConfigId, config.id), eq(rotationPayoutLegs.fired, false)))
//         .orderBy(asc(rotationPayoutLegs.sequenceOrder))
//         .limit(1);

//       if (!nextLeg) continue; // rotation complete — every leg has fired.
//       if (nextLeg.scheduledDate > new Date()) continue; // not due yet.

//       const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
//       const balance = await LedgerService.getBalance(potAccount.id);

//       if (balance < nextLeg.amountKobo) {
//         console.warn(
//           `Rotation leg ${nextLeg.id} (pot ${pot.id}, sequence ${nextLeg.sequenceOrder}) due but underfunded (balance=${balance}, needs=${nextLeg.amountKobo}) — skipping, leg stays unfired`
//         );
//         skipped++;
//         continue;
//       }

//       try {
//         await postFixedAmountDisbursement(pot, "payout", nextLeg.amountKobo, {
//           destinationAccount: nextLeg.destinationAccount,
//           destinationBank: nextLeg.destinationBank,
//         });
//         await markLegFired(nextLeg);
//         fired++;
//       } catch (err) {
//         console.error(`Rotation leg ${nextLeg.id} failed for pot ${pot.id}:`, err);
//         skipped++;
//       }
//     }

//     return { fired, skipped };
//   },
// };

export const PayoutSchedulerService = {
  /**
   * Enqueues a disbursement job for every OPEN pot's recurring config
   * that's due and funded. nextRunAt only advances once the WORKER
   * confirms the transfer actually succeeded (see
   * advance_recurring_next_run_at in worker.ts) — NOT at enqueue time,
   * since enqueueing merely hands the job off; the transfer itself may
   * still fail. "fired" below means "successfully enqueued this sweep,"
   * not "completed" — completion is now async.
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
        await postFixedAmountDisbursement(
          pot,
          "payout",
          config.amountKobo,
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

  async fireDueRotationLegs(): Promise<{ fired: number; skipped: number }> {
    const openPots = await db
      .select({ config: rotationPayoutConfigs, pot: pots })
      .from(rotationPayoutConfigs)
      .innerJoin(pots, eq(pots.id, rotationPayoutConfigs.potId))
      .where(eq(pots.status, "open"));

    let fired = 0;
    let skipped = 0;

    for (const { config, pot } of openPots) {
      const [nextLeg] = await db
        .select()
        .from(rotationPayoutLegs)
        .where(and(eq(rotationPayoutLegs.rotationConfigId, config.id), eq(rotationPayoutLegs.fired, false)))
        .orderBy(asc(rotationPayoutLegs.sequenceOrder))
        .limit(1);

      if (!nextLeg) continue;
      if (nextLeg.scheduledDate > new Date()) continue;

      const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
      const balance = await LedgerService.getBalance(potAccount.id);

      if (balance < nextLeg.amountKobo) {
        console.warn(
          `Rotation leg ${nextLeg.id} (pot ${pot.id}, sequence ${nextLeg.sequenceOrder}) due but underfunded — skipping, leg stays unfired`
        );
        skipped++;
        continue;
      }

      try {
        await postFixedAmountDisbursement(
          pot,
          "payout",
          nextLeg.amountKobo,
          { destinationAccount: nextLeg.destinationAccount, destinationBank: nextLeg.destinationBank },
          { type: "mark_rotation_leg_fired", rotationLegId: nextLeg.id }
        );
        fired++;
      } catch (err) {
        console.error(`Failed to enqueue rotation leg ${nextLeg.id} for pot ${pot.id}:`, err);
        skipped++;
      }
    }

    return { fired, skipped };
  },
};

/** Advances a recurring payout config's nextRunAt by intervalDays — only called after that occurrence's disbursement has actually succeeded/gone PENDING_BILLING. */
async function advanceNextRunAt(config: RecurringPayoutConfig): Promise<void> {
  const nextRunAt = new Date(config.nextRunAt.getTime() + config.intervalDays * 24 * 60 * 60 * 1000);
  await db.update(recurringPayoutConfigs).set({ nextRunAt }).where(eq(recurringPayoutConfigs.id, config.id));
}

/** Marks a rotation leg fired — only called after that leg's disbursement has actually succeeded/gone PENDING_BILLING. */
async function markLegFired(leg: RotationPayoutLeg): Promise<void> {
  await db.update(rotationPayoutLegs).set({ fired: true, firedAt: new Date() }).where(eq(rotationPayoutLegs.id, leg.id));
}
