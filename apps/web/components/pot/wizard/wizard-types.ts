import type { PayoutMode, PotType, RefundType, RotationLeg } from "@/lib/mock/types";

export type WizardState = {
  title: string;
  description: string;
  potType: PotType;
  refundType: RefundType;
  minContributionKobo: string;
  maxContributionKobo: string;
  payoutMode: PayoutMode | null;

  targetDestinationAccount: string;
  targetDestinationBank: string;
  targetDate: string;
  targetAmountNaira: string;
  adminManualEnabled: boolean;

  recurringDestinationAccount: string;
  recurringDestinationBank: string;
  recurringAmountNaira: string;
  recurringIntervalDays: string;
  recurringNextRunAt: string;

  rotationLegs: RotationLeg[];
};

export const initialWizardState: WizardState = {
  title: "",
  description: "",
  potType: "private",
  refundType: "contributors",
  minContributionKobo: "",
  maxContributionKobo: "",
  payoutMode: null,

  targetDestinationAccount: "",
  targetDestinationBank: "",
  targetDate: "",
  targetAmountNaira: "",
  adminManualEnabled: false,

  recurringDestinationAccount: "",
  recurringDestinationBank: "",
  recurringAmountNaira: "",
  recurringIntervalDays: "30",
  recurringNextRunAt: "",

  rotationLegs: [],
};

export const wizardSteps = ["basics", "mode", "config", "review"] as const;
export type WizardStep = (typeof wizardSteps)[number];
