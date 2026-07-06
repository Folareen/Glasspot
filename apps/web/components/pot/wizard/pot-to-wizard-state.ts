import type {
  ManualPayoutConfig,
  PotResponse,
  RecurringPayoutConfig,
  ScheduledPayoutConfig,
  TargetBasedPayoutConfig,
} from "@/lib/mock/types";
import { initialWizardState, type WizardState } from "./wizard-types";

function toDateInput(iso?: string) {
  return iso ? iso.slice(0, 10) : "";
}

function toNaira(kobo?: string) {
  return kobo ? String(Number(kobo) / 100) : "";
}

export function potToWizardState(pot: PotResponse): WizardState {
  const base: WizardState = {
    ...initialWizardState,
    title: pot.title,
    description: pot.description ?? "",
    potType: pot.potType,
    refundType: pot.refundType,
    minContribution: toNaira(pot.minContribution),
    maxContribution: toNaira(pot.maxContribution ?? undefined),
    payoutMode: pot.payoutMode,
  };

  if (pot.payoutMode === "target_based") {
    const config = pot.payoutConfig as TargetBasedPayoutConfig;
    return {
      ...base,
      targetDestinationAccount: config.destinationAccount,
      targetDestinationBank: config.destinationBank,
      targetDate: toDateInput(config.targetDate),
      targetAmountNaira: toNaira(config.targetAmount),
    };
  }

  if (pot.payoutMode === "manual") {
    const config = pot.payoutConfig as ManualPayoutConfig;
    return {
      ...base,
      manualDestinationAccount: config.destinationAccount ?? "",
      manualDestinationBank: config.destinationBank ?? "",
    };
  }

  if (pot.payoutMode === "recurring") {
    const config = pot.payoutConfig as RecurringPayoutConfig;
    return {
      ...base,
      recurringDestinationAccount: config.destinationAccount,
      recurringDestinationBank: config.destinationBank,
      recurringAmountNaira: toNaira(config.amount),
      recurringIntervalDays: String(config.intervalDays),
      recurringNextRunAt: toDateInput(config.nextRunAt),
    };
  }

  if (pot.payoutMode === "scheduled") {
    const config = pot.payoutConfig as ScheduledPayoutConfig;
    return {
      ...base,
      scheduledOrdered: config.ordered,
      scheduledLegs: config.legs.map((leg) => ({
        ...leg,
        amount: toNaira(leg.amount),
        scheduledDate: toDateInput(leg.scheduledDate),
      })),
    };
  }

  return base;
}
