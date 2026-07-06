// src/modules/pots/target-based-payout.service.ts
import { and, eq } from "drizzle-orm";
import db, { pots, targetBasedPayoutConfigs } from "@/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { postFixedAmountDisbursement } from "./pots.service";

/** Fires due target_based payouts automatically (targetDate or targetAmount reached) by disbursing the pot's full balance — this mode has no admin-manual trigger and pays out once. */
export const TargetBasedPayoutService = {
  // config.fired only flips true once the worker confirms the transfer succeeded (mark_target_based_fired),
  // never at enqueue time, so a failed transfer stays eligible to retry next sweep rather than being dropped.
  async fireDueTargetBasedPayouts(): Promise<{ fired: number; skipped: number }> {
    const due = await db
      .select({ config: targetBasedPayoutConfigs, pot: pots })
      .from(targetBasedPayoutConfigs)
      .innerJoin(pots, eq(pots.id, targetBasedPayoutConfigs.potId))
      .where(and(eq(pots.status, "open"), eq(targetBasedPayoutConfigs.fired, false)));

    let fired = 0;
    let skipped = 0;

    for (const { config, pot } of due) {
      const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
      const balance = await LedgerService.getBalance(potAccount.id);

      const targetDateReached = config.targetDate != null && config.targetDate <= new Date();
      const targetAmountReached = config.targetAmount != null && balance >= config.targetAmount;

      if (!targetDateReached && !targetAmountReached) {
        continue; // not due yet — not a failure, just nothing to do
      }

      if (balance <= 0n) {
        console.warn(`Target-based payout condition met for pot ${pot.id} but balance is zero — skipping`);
        skipped++;
        continue;
      }

      try {
        await postFixedAmountDisbursement(
          pot,
          "payout",
          balance,
          { destinationAccount: config.destinationAccount, destinationBank: config.destinationBank },
          { type: "mark_target_based_fired", targetConfigId: config.id }
        );
        fired++;
      } catch (err) {
        // Enqueue failure, or the pot already has a payout/refund operation
        // in flight from some other source (e.g. an admin-triggered refund
        // moments earlier) — the pendingOperation lock in
        // postFixedAmountDisbursement rejects the second attempt.
        // config.fired stays false either way — retried next sweep.
        console.error(`Failed to enqueue target-based payout for pot ${pot.id}:`, err);
        skipped++;
      }
    }

    return { fired, skipped };
  },
};