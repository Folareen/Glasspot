import type {
  ManualPayoutConfig,
  PotResponse,
  RecurringPayoutConfig,
  ScheduledPayoutConfig,
  TargetBasedPayoutConfig,
} from "@/lib/types";
import { initialWizardState, type WizardState } from "./wizard-types";

function toDateInput(iso?: string | null) {
  return iso ? iso.slice(0, 10) : "";
}

// The wire contract is already naira strings (see pots.schema.ts's
// nairaAmount) — wizard state holds the same naira string as-is, no
// conversion needed. Kept as a named function (rather than assigning the
// field directly) so a missing/optional field still normalizes to "" like
// every other wizard string field, and so this is the one place to touch
// if the wire shape ever changes.
function toWizardAmount(naira?: string | null) {
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
    goalAmount: toWizardAmount(pot.goalAmount ?? undefined),
    payoutMode: pot.payoutMode,
  };

  if (pot.payoutMode === "target_based") {
    const config = pot.payoutConfig as TargetBasedPayoutConfig;
    return {
      ...base,
      targetDestinationAccount: config.destinationAccount,
      targetDestinationBank: config.destinationBank,
      // Already resolved server-side when this pot was created/last saved — pre-fill as
      // confirmed so re-opening the edit form doesn't spuriously demand re-verifying an
      // unchanged, already-valid destination. Editing either field re-triggers a fresh lookup
      // (see TargetBasedConfigStep.tsx's sync effect), which naturally supersedes this.
      targetDestinationConfirmedName: config.destinationAccountName,
      targetDate: toDateInput(config.targetDate),
      targetAmountNaira: toWizardAmount(config.targetAmount),
    };
  }

  if (pot.payoutMode === "manual") {
    // null here means "no fixed destination configured" (the only payoutMode where the config
    // row itself is optional — see PotsService.getPayoutConfig/insertPayoutConfig on the backend)
    // rather than a real ManualPayoutConfig with every field null; both mean the same thing to
    // the wizard, so they're handled identically.
    const config = pot.payoutConfig as ManualPayoutConfig | null;
    return {
      ...base,
      manualDestinationAccount: config?.destinationAccount ?? "",
      manualDestinationBank: config?.destinationBank ?? "",
      manualDestinationConfirmedName: config?.destinationAccountName ?? null,
    };
  }

  if (pot.payoutMode === "recurring") {
    const config = pot.payoutConfig as RecurringPayoutConfig;
    return {
      ...base,
      recurringDestinationAccount: config.destinationAccount,
      recurringDestinationBank: config.destinationBank,
      recurringDestinationConfirmedName: config.destinationAccountName,
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
        destinationAccount: leg.destinationAccount,
        destinationBank: leg.destinationBank,
        destinationConfirmedName: leg.destinationAccountName,
        sequenceOrder: leg.sequenceOrder,
        amount: toWizardAmount(leg.amount),
        scheduledDate: toDateInput(leg.scheduledDate),
      })),
    };
  }

  return base;
}
