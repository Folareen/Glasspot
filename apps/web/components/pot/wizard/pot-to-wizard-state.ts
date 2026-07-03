import type {
  PotResponse,
  RecurringPayoutConfig,
  RotationPayoutConfig,
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
    minContributionKobo: toNaira(pot.minContributionKobo),
    maxContributionKobo: toNaira(pot.maxContributionKobo ?? undefined),
    payoutMode: pot.payoutMode,
  };

  if (pot.payoutMode === "target_based") {
    const config = pot.payoutConfig as TargetBasedPayoutConfig;
    return {
      ...base,
      targetDestinationAccount: config.destinationAccount,
      targetDestinationBank: config.destinationBank,
      targetDate: toDateInput(config.targetDate),
      targetAmountNaira: toNaira(config.targetAmountKobo),
      adminManualEnabled: config.adminManualEnabled ?? false,
    };
  }

  if (pot.payoutMode === "recurring") {
    const config = pot.payoutConfig as RecurringPayoutConfig;
    return {
      ...base,
      recurringDestinationAccount: config.destinationAccount,
      recurringDestinationBank: config.destinationBank,
      recurringAmountNaira: toNaira(config.amountKobo),
      recurringIntervalDays: String(config.intervalDays),
      recurringNextRunAt: toDateInput(config.nextRunAt),
    };
  }

  if (pot.payoutMode === "rotation") {
    const config = pot.payoutConfig as RotationPayoutConfig;
    return {
      ...base,
      rotationLegs: config.legs.map((leg) => ({
        ...leg,
        amountKobo: toNaira(leg.amountKobo),
        scheduledDate: toDateInput(leg.scheduledDate),
      })),
    };
  }

  return base;
}
