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

// The wire contract is already naira strings (see pots.schema.ts's
// nairaAmount) — wizard state holds the same naira string as-is, no
// conversion needed. Kept as a named function (rather than assigning the
// field directly) so a missing/optional field still normalizes to "" like
// every other wizard string field, and so this is the one place to touch
// if the wire shape ever changes.
function toWizardAmount(naira?: string) {
  return naira ?? "";
}

export function potToWizardState(pot: PotResponse): WizardState {
  const base: WizardState = {
    ...initialWizardState,
    title: pot.title,
    description: pot.description ?? "",
    potType: pot.potType,
    refundType: pot.refundType,
    minContribution: toWizardAmount(pot.minContribution),
    maxContribution: toWizardAmount(pot.maxContribution ?? undefined),
    payoutMode: pot.payoutMode,
  };

  if (pot.payoutMode === "target_based") {
    const config = pot.payoutConfig as TargetBasedPayoutConfig;
    return {
      ...base,
      targetDestinationAccount: config.destinationAccount,
      targetDestinationBank: config.destinationBank,
      targetDate: toDateInput(config.targetDate),
      targetAmountNaira: toWizardAmount(config.targetAmount),
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
      recurringAmountNaira: toWizardAmount(config.amount),
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
        amount: toWizardAmount(leg.amount),
        scheduledDate: toDateInput(leg.scheduledDate),
      })),
    };
  }

  return base;
}
