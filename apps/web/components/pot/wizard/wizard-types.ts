import type { PayoutMode, PotType, RefundType, ScheduledLeg } from "@/lib/mock/types";

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
  scheduledLegs: ScheduledLeg[];
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
