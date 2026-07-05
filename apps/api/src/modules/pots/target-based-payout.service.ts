// src/modules/pots/target-based-payout.service.ts
import { and, eq } from "drizzle-orm";
import db, { pots, targetBasedPayoutConfigs } from "@glasspot/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { postFixedAmountDisbursement } from "./pots.service";

/**
 * Fires due target_based payouts automatically — targetDate reached or
 * targetAmountKobo reached (adminManualEnabled is handled separately, via
 * an admin explicitly calling PotsService.triggerPayout — see that
 * method's target_based branch). Fires the pot's FULL current balance,
 * matching target_based's documented "pays out once" semantic (unlike
 * recurring/rotation's fixed amountKobo per occurrence).
 *
 * config.fired only flips true once the WORKER confirms the transfer
 * actually succeeded (see mark_target_based_fired in worker.ts) — never
 * here at enqueue time, so a failed transfer leaves the condition
 * eligible to retry next sweep rather than being silently dropped.
 */
export const TargetBasedPayoutService = {
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
      const targetAmountReached = config.targetAmountKobo != null && balance >= config.targetAmountKobo;

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
        // Enqueue failure, or the pot already has an operation in flight
        // (e.g. an admin manually triggered it moments earlier via
        // triggerPayout — the pendingOperation lock in
        // postFixedAmountDisbursement rejects the second attempt).
        // config.fired stays false either way — retried next sweep.
        console.error(`Failed to enqueue target-based payout for pot ${pot.id}:`, err);
        skipped++;
      }
    }

    return { fired, skipped };
  },
};