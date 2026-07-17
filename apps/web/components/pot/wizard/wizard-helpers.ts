import type { CreatePotInput } from "@/lib/api";
import { nairaAmountToNumber, OUTBOUND_FEE, toNairaAmount } from "@/lib/money";
import type { WizardState } from "./wizard-types";

/** True for a wizard amount field holding a positive number — the wizard's own floor, mirroring the backend's nairaAmount schema (apps/backend/src/modules/pots/pots.schema.ts) rejecting "0.00"/an unset amount. Truthiness alone ("0" is a non-empty string) isn't enough here. Exported for reuse by minContribution/maxContribution's own validation in the pot create/edit pages. */
export function isPositiveAmount(raw: string): boolean {
  return Boolean(raw) && nairaAmountToNumber(raw) > 0;
}

/** True for a wizard interval field holding a positive integer number of days — mirrors the backend's recurringPayoutConfigSchema (intervalDays: z.number().int().min(1)). Same truthiness trap as isPositiveAmount: "0" is a non-empty string, so `state.recurringIntervalDays &&` alone would accept it. */
export function isValidIntervalDays(raw: string): boolean {
  const n = Number(raw);
  return Boolean(raw) && Number.isInteger(n) && n >= 1;
}

/**
 * True for a target_based target amount that could actually pay out something — target_based
 * always disburses the pot's full balance, netting the flat ₦50 outbound fee out of it (see
 * apps/backend/src/lib/fees.ts and target-based-payout-configs.ts's targetAmount comment), so a
 * target at or below that fee would fire a payout of ≤0. Mirrors the backend's own
 * targetBasedPayoutConfigSchema refine.
 */
export function isValidTargetAmount(raw: string): boolean {
  return isPositiveAmount(raw) && nairaAmountToNumber(raw) > nairaAmountToNumber(OUTBOUND_FEE);
}

export function toIsoDate(date: string) {
  return date ? new Date(date).toISOString() : new Date().toISOString();
}

/** Reshapes a wizard amount field (whatever the user typed, e.g. "5000" or "5000.5") into the wire-format "NN.NN" naira string, falling back to "0.00" for an empty/invalid field — callers only call this where the field is already known non-empty (isConfigStepValid), so the fallback is defensive, never expected to fire. */
function wireAmount(raw: string): string {
  return toNairaAmount(raw) ?? "0.00";
}

export function buildPayoutConfig(state: WizardState): CreatePotInput["payoutConfig"] {
  switch (state.payoutMode) {
    case "manual":
      return state.manualDestinationAccount && state.manualDestinationBank
        ? {
            destinationAccount: state.manualDestinationAccount,
            destinationBank: state.manualDestinationBank,
          }
        : {};
    case "recurring":
      return {
        destinationAccount: state.recurringDestinationAccount,
        destinationBank: state.recurringDestinationBank,
        amount: wireAmount(state.recurringAmountNaira),
        // isConfigStepValid already requires isValidIntervalDays before this step can be left, so
        // this is never actually reached with an invalid value — no silent "0 becomes 30" fallback
        // anymore (a prior version did `|| 30`, changing what's submitted without telling the
        // user, since the review step still showed whatever they'd typed).
        intervalDays: Number(state.recurringIntervalDays),
        nextRunAt: toIsoDate(state.recurringNextRunAt),
      };
    case "scheduled":
      return {
        ordered: state.scheduledOrdered,
        legs: state.scheduledLegs.map((leg) => ({
          ...leg,
          amount: wireAmount(leg.amount),
          scheduledDate: toIsoDate(leg.scheduledDate),
        })),
      };
    case "target_based":
    default:
      return {
        destinationAccount: state.targetDestinationAccount,
        destinationBank: state.targetDestinationBank,
        targetDate: state.targetDate ? toIsoDate(state.targetDate) : undefined,
        targetAmount: state.targetAmountNaira ? wireAmount(state.targetAmountNaira) : undefined,
      };
  }
}

export function isConfigStepValid(state: WizardState) {
  switch (state.payoutMode) {
    case "manual":
      // Destination is optional, but if either half is filled in, both must be — mirrors the
      // backend's both-or-neither validation — and once both are, the account name must have
      // resolved too (a typo'd account otherwise only fails at final pot creation).
      return Boolean(state.manualDestinationAccount) === Boolean(state.manualDestinationBank) &&
        (!state.manualDestinationAccount || Boolean(state.manualDestinationConfirmedName));
    case "recurring":
      return Boolean(
        state.recurringDestinationAccount &&
          state.recurringDestinationBank &&
          state.recurringDestinationConfirmedName &&
          isPositiveAmount(state.recurringAmountNaira) &&
          isValidIntervalDays(state.recurringIntervalDays) &&
          state.recurringNextRunAt
      );
    case "scheduled":
      return (
        state.scheduledLegs.length > 0 &&
        state.scheduledLegs.every(
          (leg) =>
            leg.destinationAccount &&
            leg.destinationBank &&
            leg.destinationConfirmedName &&
            isPositiveAmount(leg.amount) &&
            leg.scheduledDate
        )
      );
    case "target_based":
      return Boolean(
        state.targetDestinationAccount &&
          state.targetDestinationBank &&
          state.targetDestinationConfirmedName &&
          (state.targetDate || isValidTargetAmount(state.targetAmountNaira))
      );
    default:
      return false;
  }
}
