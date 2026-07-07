// src/modules/pots/target-based-payout.service.ts
import { and, eq } from "drizzle-orm";
import db, { pots, targetBasedPayoutConfigs, type Pot, type TargetBasedPayoutConfig } from "@/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { postFixedAmountDisbursement } from "./pots.service";

/** Attempts to fire one pot's target_based payout if its condition is met, given its already-loaded config/current balance — shared by the immediate post-contribution check and the daily sweep so the actual fire/skip logic (and its logging) lives in exactly one place. Returns which outcome occurred. */
async function tryFire(
  pot: Pot,
  config: TargetBasedPayoutConfig,
  balance: bigint
): Promise<"fired" | "skipped" | "not_due"> {
  const targetDateReached = config.targetDate != null && config.targetDate <= new Date();
  const targetAmountReached = config.targetAmount != null && balance >= config.targetAmount;

  if (!targetDateReached && !targetAmountReached) {
    return "not_due";
  }

  if (balance <= 0n) {
    console.warn(`Target-based payout condition met for pot ${pot.id} but balance is zero — skipping`);
    return "skipped";
  }

  try {
    await postFixedAmountDisbursement(
      pot,
      "payout",
      balance,
      { destinationAccount: config.destinationAccount, destinationBank: config.destinationBank },
      { type: "mark_target_based_fired", targetConfigId: config.id }
    );
    return "fired";
  } catch (err) {
    // Enqueue failure, or the pot already has a payout/refund operation in flight from some other
    // source (e.g. an admin-triggered refund moments earlier) — the pendingOperation lock in
    // postFixedAmountDisbursement rejects the second attempt. config.fired stays false either
    // way — retried by the next daily sweep, or the next contribution that lands.
    console.error(`Failed to enqueue target-based payout for pot ${pot.id}:`, err);
    return "skipped";
  }
}

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
      const outcome = await tryFire(pot, config, balance);
      if (outcome === "fired") fired++;
      else if (outcome === "skipped") skipped++;
    }

    return { fired, skipped };
  },

  /**
   * Checks and immediately fires this one pot's target_based payout if its targetAmount is now
   * met — called right after a contribution is confirmed funded (see
   * ContributionsService.confirmFunding) so reaching the target pays out right away instead of
   * waiting for the next daily sweep (fireDueTargetBasedPayouts still covers targetDate-based
   * pots, and acts as a safety-net retry for a fire this path failed to enqueue). No-op for any
   * pot that isn't an open, unfired target_based pot.
   */
  async checkAndFireForPot(potId: string): Promise<void> {
    const [row] = await db
      .select({ config: targetBasedPayoutConfigs, pot: pots })
      .from(targetBasedPayoutConfigs)
      .innerJoin(pots, eq(pots.id, targetBasedPayoutConfigs.potId))
      .where(
        and(
          eq(targetBasedPayoutConfigs.potId, potId),
          eq(pots.status, "open"),
          eq(targetBasedPayoutConfigs.fired, false)
        )
      );

    if (!row) return; // not a target_based pot, not open, or already fired

    const potAccount = await AccountsService.getOrCreatePotAccount(potId);
    const balance = await LedgerService.getBalance(potAccount.id);
    await tryFire(row.pot, row.config, balance);
  },
};