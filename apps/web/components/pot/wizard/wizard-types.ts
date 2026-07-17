import type { PayoutMode, PotType, RefundType } from "@/lib/types";

// Wizard-local leg shape — a subset of the wire ScheduledLeg (lib/types.ts) that only holds what
// the form collects. destinationAccountName/fired are server-computed/server-owned fields the
// wizard never sets; buildPayoutConfig (wizard-helpers.ts) sends just these four fields per leg.
// destinationConfirmedName mirrors useBankAccountLookup's own return value (tagged to the exact
// account+bank pair it resolved for) so isConfigStepValid can require a confirmed destination
// without re-running the lookup itself — see ScheduledLegBuilder.tsx's sync effect.
export type WizardScheduledLeg = {
  destinationAccount: string;
  destinationBank: string;
  destinationConfirmedName: string | null;
  sequenceOrder: number;
  amount: string;
  scheduledDate: string;
};

export type WizardState = {
  title: string;
  description: string;
  potType: PotType;
  refundType: RefundType;
  minContribution: string;
  maxContribution: string;
  goalAmount: string;
  payoutMode: PayoutMode | null;

  targetDestinationAccount: string;
  targetDestinationBank: string;
  // Mirrors useBankAccountLookup's confirmedName for this destination — see
  // WizardScheduledLeg's destinationConfirmedName comment for why this is lifted into state.
  targetDestinationConfirmedName: string | null;
  targetDate: string;
  targetAmountNaira: string;

  manualDestinationAccount: string;
  manualDestinationBank: string;
  manualDestinationConfirmedName: string | null;

  recurringDestinationAccount: string;
  recurringDestinationBank: string;
  recurringDestinationConfirmedName: string | null;
  recurringAmountNaira: string;
  recurringIntervalDays: string;
  recurringNextRunAt: string;

  scheduledOrdered: boolean;
  scheduledLegs: WizardScheduledLeg[];
};

export const initialWizardState: WizardState = {
  title: "",
  description: "",
  potType: "private",
  refundType: "contributors",
  minContribution: "",
  maxContribution: "",
  goalAmount: "",
  payoutMode: null,

  targetDestinationAccount: "",
  targetDestinationBank: "",
  targetDestinationConfirmedName: null,
  targetDate: "",
  targetAmountNaira: "",

  manualDestinationAccount: "",
  manualDestinationBank: "",
  manualDestinationConfirmedName: null,

  recurringDestinationAccount: "",
  recurringDestinationBank: "",
  recurringDestinationConfirmedName: null,
  recurringAmountNaira: "",
  recurringIntervalDays: "30",
  recurringNextRunAt: "",

  scheduledOrdered: true,
  scheduledLegs: [],
};

export const wizardSteps = ["basics", "mode", "config", "review"] as const;
export type WizardStep = (typeof wizardSteps)[number];
