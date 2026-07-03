import type { PayoutConfig } from "@/lib/mock/types";
import type { WizardState } from "./wizard-types";

export function toKobo(naira: string) {
  return String(Math.round(Number(naira) * 100));
}

export function toIsoDate(date: string) {
  return date ? new Date(date).toISOString() : new Date().toISOString();
}

export function buildPayoutConfig(state: WizardState): PayoutConfig {
  switch (state.payoutMode) {
    case "manual":
      return {};
    case "recurring":
      return {
        destinationAccount: state.recurringDestinationAccount,
        destinationBank: state.recurringDestinationBank,
        amountKobo: toKobo(state.recurringAmountNaira),
        intervalDays: Number(state.recurringIntervalDays) || 30,
        nextRunAt: toIsoDate(state.recurringNextRunAt),
      };
    case "rotation":
      return {
        legs: state.rotationLegs.map((leg) => ({
          ...leg,
          amountKobo: toKobo(leg.amountKobo),
          scheduledDate: toIsoDate(leg.scheduledDate),
        })),
      };
    case "target_based":
    default:
      return {
        destinationAccount: state.targetDestinationAccount,
        destinationBank: state.targetDestinationBank,
        targetDate: state.targetDate ? toIsoDate(state.targetDate) : undefined,
        targetAmountKobo: state.targetAmountNaira ? toKobo(state.targetAmountNaira) : undefined,
        adminManualEnabled: state.adminManualEnabled || undefined,
      };
  }
}

export function isConfigStepValid(state: WizardState) {
  switch (state.payoutMode) {
    case "manual":
      return true;
    case "recurring":
      return Boolean(
        state.recurringDestinationAccount &&
          state.recurringDestinationBank &&
          state.recurringAmountNaira &&
          state.recurringIntervalDays &&
          state.recurringNextRunAt
      );
    case "rotation":
      return (
        state.rotationLegs.length > 0 &&
        state.rotationLegs.every(
          (leg) => leg.destinationAccount && leg.destinationBank && leg.amountKobo && leg.scheduledDate
        )
      );
    case "target_based":
      return Boolean(
        state.targetDestinationAccount &&
          state.targetDestinationBank &&
          (state.targetDate || state.targetAmountNaira || state.adminManualEnabled)
      );
    default:
      return false;
  }
}
