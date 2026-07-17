// src/modules/pots/target-based-payout.service.ts
import { and, eq, isNull, or } from "drizzle-orm";
import db, { pots, targetBasedPayoutConfigs, type Pot, type TargetBasedPayoutConfig } from "@/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { postDisbursement } from "./pots.service";

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

  try {
    // postDisbursement nets the outbound fee off the full balance itself (balance - OUTBOUND_FEE)
    // and throws if that's <= 0 — the same full-balance path manual payout/refund use.
    await postDisbursement(
      pot,
      "payout",
      { destinationAccount: config.destinationAccount, destinationBank: config.destinationBank },
      { type: "mark_target_based_fired", targetConfigId: config.id }
    );
    return "fired";
  } catch (err) {
    // Insufficient balance, enqueue failure, or the pot already has a payout/refund operation in
    // flight from some other source (e.g. an admin-triggered refund moments earlier) — the
    // pendingOperation lock rejects the second attempt. config.fired stays false either way —
    // retried by the next daily sweep, or the next contribution that lands.
    console.error(`Failed to enqueue target-based payout for pot ${pot.id}:`, err);
    return "skipped";
  }
}

// A config is still eligible to fire if it hasn't yet, OR it has but carries no targetDate at
// all — a pure-amount config is a repeat trigger (see worker.ts's mark_target_based_fired
// handling: a targetDate closes the pot on fire, no targetDate leaves it open to fire again
// whenever the balance reaches the target again). A config WITH a targetDate never matches this
// once fired, since its pot is already closed and excluded by the eq(pots.status, "open") below
// regardless.
const stillEligible = or(
  eq(targetBasedPayoutConfigs.fired, false),
  and(eq(targetBasedPayoutConfigs.fired, true), isNull(targetBasedPayoutConfigs.targetDate))
);

/** Fires due target_based payouts automatically (targetDate or targetAmount reached) by disbursing the pot's full balance — this mode has no admin-manual trigger. A targetDate config fires once then closes the pot; a pure-amount config fires repeatedly, every time contributions bring the balance back up to the target. */
export const TargetBasedPayoutService = {
  /**
   * Called by worker.ts's applyOnSuccess once a target_based payout has actually been confirmed
   * to succeed — records the fire, and closes the pot only for a config that carries a targetDate
   * (a one-shot commitment); a pure-amount config stays open so it can fire again. Lives here
   * rather than inline in worker.ts so it's exercised directly in tests without importing that
   * module's own Redis/BullMQ worker bootstrapping as a side effect.
   */
  async applyFired(targetConfigId: string): Promise<void> {
    const [config] = await db
      .update(targetBasedPayoutConfigs)
      .set({ fired: true, firedAt: new Date() })
      .where(eq(targetBasedPayoutConfigs.id, targetConfigId))
      .returning();
    if (!config) return;

    if (config.targetDate != null) {
      await db
        .update(pots)
        .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(pots.id, config.potId), eq(pots.status, "open"), isNull(pots.pendingOperation)));
    }
  },

  // config.fired only flips true once the worker confirms the transfer succeeded (mark_target_based_fired),
  // never at enqueue time, so a failed transfer stays eligible to retry next sweep rather than being dropped.
  async fireDueTargetBasedPayouts(): Promise<{ fired: number; skipped: number }> {
    const due = await db
      .select({ config: targetBasedPayoutConfigs, pot: pots })
      .from(targetBasedPayoutConfigs)
      .innerJoin(pots, eq(pots.id, targetBasedPayoutConfigs.potId))
      .where(and(eq(pots.status, "open"), stillEligible));

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
   * pot that isn't open, isn't target_based, or isn't currently eligible (see stillEligible).
   */
  async checkAndFireForPot(potId: string): Promise<void> {
    const [row] = await db
      .select({ config: targetBasedPayoutConfigs, pot: pots })
      .from(targetBasedPayoutConfigs)
      .innerJoin(pots, eq(pots.id, targetBasedPayoutConfigs.potId))
      .where(and(eq(targetBasedPayoutConfigs.potId, potId), eq(pots.status, "open"), stillEligible));

    if (!row) return; // not a target_based pot, not open, or not currently eligible

    const potAccount = await AccountsService.getOrCreatePotAccount(potId);
    const balance = await LedgerService.getBalance(potAccount.id);
    await tryFire(row.pot, row.config, balance);
  },
};