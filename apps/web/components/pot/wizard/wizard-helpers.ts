import type { PayoutConfig } from "@/lib/mock/types";
import { toNairaAmount } from "@/lib/money";
import type { WizardState } from "./wizard-types";

export function toIsoDate(date: string) {
  return date ? new Date(date).toISOString() : new Date().toISOString();
}

/** Reshapes a wizard amount field (whatever the user typed, e.g. "5000" or "5000.5") into the wire-format "NN.NN" naira string, falling back to "0.00" for an empty/invalid field — callers only call this where the field is already known non-empty (isConfigStepValid), so the fallback is defensive, never expected to fire. */
function wireAmount(raw: string): string {
  return toNairaAmount(raw) ?? "0.00";
}

export function buildPayoutConfig(state: WizardState): PayoutConfig {
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
        intervalDays: Number(state.recurringIntervalDays) || 30,
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
      // Destination is optional, but if either half is filled in, both
      // must be — mirrors the backend's both-or-neither validation.
      return Boolean(state.manualDestinationAccount) === Boolean(state.manualDestinationBank);
    case "recurring":
      return Boolean(
        state.recurringDestinationAccount &&
          state.recurringDestinationBank &&
          state.recurringAmountNaira &&
          state.recurringIntervalDays &&
          state.recurringNextRunAt
      );
    case "scheduled":
      return (
        state.scheduledLegs.length > 0 &&
        state.scheduledLegs.every(
          (leg) => leg.destinationAccount && leg.destinationBank && leg.amount && leg.scheduledDate
        )
      );
    case "target_based":
      return Boolean(
        state.targetDestinationAccount &&
          state.targetDestinationBank &&
          (state.targetDate || state.targetAmountNaira)
      );
    default:
      return false;
  }
}
