import type { PayoutMode, PotType, RefundType } from "@/lib/types";

// Wizard-local leg shape — a subset of the wire ScheduledLeg (lib/types.ts) that only holds what
// the form collects. destinationAccountName/fired are server-computed/server-owned fields the
// wizard never sets; buildPayoutConfig (wizard-helpers.ts) sends just these four fields per leg.
export type WizardScheduledLeg = {
  destinationAccount: string;
  destinationBank: string;
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
  targetDate: string;
  targetAmountNaira: string;

  manualDestinationAccount: string;
  manualDestinationBank: string;

  recurringDestinationAccount: string;
  recurringDestinationBank: string;
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
  targetDate: "",
  targetAmountNaira: "",

  manualDestinationAccount: "",
  manualDestinationBank: "",

  recurringDestinationAccount: "",
  recurringDestinationBank: "",
  recurringAmountNaira: "",
  recurringIntervalDays: "30",
  recurringNextRunAt: "",

  scheduledOrdered: true,
  scheduledLegs: [],
};

export const wizardSteps = ["basics", "mode", "config", "review"] as const;
export type WizardStep = (typeof wizardSteps)[number];
