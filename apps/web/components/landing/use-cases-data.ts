import { initialWizardState, type WizardState } from "@/components/pot/wizard/wizard-types";

// Mirrors apps/backend/src/db/schema/pots.ts's payoutModeEnum.
export type MvpPayoutMode = "target_based" | "manual" | "recurring" | "scheduled";
export type PotType = "public" | "private";
export type RefundType = "admin" | "contributors";

export type UseCase = {
  id: string;
  title: string;
  description: string;
  payoutMode: MvpPayoutMode;
  potType: PotType;
  refundType: RefundType;
};

/**
 * Derives a starting wizard state for the landing page's "Try it" flow from
 * a use case's own fields, rather than hand-authoring a template per use
 * case (22+ of them). The numbers/dates are placeholders the user is
 * expected to edit before creating — this only needs to be a plausible
 * starting point, not a correct one.
 */
export function buildTemplateFromUseCase(useCase: UseCase): WizardState {
  const base: WizardState = {
    ...initialWizardState,
    title: useCase.title,
    description: useCase.description,
    potType: useCase.potType,
    refundType: useCase.refundType,
    payoutMode: useCase.payoutMode,
  };

  const inFourWeeks = new Date();
  inFourWeeks.setDate(inFourWeeks.getDate() + 28);
  const fourWeeksIso = inFourWeeks.toISOString().slice(0, 10);

  switch (useCase.payoutMode) {
    case "target_based":
      return { ...base, targetAmountNaira: "100000.00" };
    case "recurring":
      return {
        ...base,
        recurringAmountNaira: "5000.00",
        recurringIntervalDays: "30",
        recurringNextRunAt: fourWeeksIso,
      };
    case "scheduled":
      return {
        ...base,
        scheduledOrdered: true,
        scheduledLegs: [
          {
            destinationAccount: "",
            destinationBank: "",
            sequenceOrder: 0,
            amount: "5000.00",
            scheduledDate: fourWeeksIso,
            firedAt: null,
          },
        ],
      };
    case "manual":
    default:
      return base;
  }
}

export const payoutModeMeta: Record<MvpPayoutMode, { label: string; description: string }> = {
  scheduled: {
    label: "Set schedule",
    description:
      "Pays out on a fixed set of dates decided upfront: either each member in turn (ajo/esusu), or every payout independently, for staged or installment disbursements.",
  },
  manual: {
    label: "Trusted trigger",
    description: "Pays out whenever an admin triggers it, no condition attached, but always logged for the pot to see.",
  },
  target_based: {
    label: "Hits a target",
    description: "Pays out to one destination automatically once an amount or date is reached.",
  },
  recurring: {
    label: "Repeats automatically",
    description: "Pays the same amount, to the same destination, on a fixed interval, until the pot closes.",
  },
};

export const potTypeBadge: Record<PotType, string> = {
  public: "Public",
  private: "Private",
};

export const refundTypeBadge: Record<RefundType, string> = {
  admin: "Admin refunds",
  contributors: "Contributor refunds",
};

export const featuredUseCases: UseCase[] = [
  {
    id: "rotating-ajo",
    title: "Installment & rotating ajo",
    description:
      "The same trusted circle, run properly. Whether everyone's paid in turn (ajo/esusu) or a big purchase is paid off in stages, it runs on schedule, automatically.",
    payoutMode: "scheduled",
    potType: "private",
    refundType: "contributors",
  },
  {
    id: "emergency-fundraising",
    title: "Fundraising & emergencies",
    description:
      "Medical bills, disaster relief, a sudden crisis. Anyone can contribute, no membership required, and every payout is logged for every contributor to see.",
    payoutMode: "manual",
    potType: "public",
    refundType: "admin",
  },
  {
    id: "weddings",
    title: "Events & ceremonies",
    description:
      "Office colleagues, family, or friends pooling for a couple's big day. Locked to a date or amount, paid to the couple, refunded to contributors if the target isn't met.",
    payoutMode: "target_based",
    potType: "private",
    refundType: "contributors",
  },
  {
    id: "hostel-dues",
    title: "Housing/community & association monthly dues & levies",
    description:
      'Same amount, same date, every month, for generator fuel, cleaning, security. Set it once and it fires on its own. No more chasing people, no more "oga I sent it".',
    payoutMode: "recurring",
    potType: "private",
    refundType: "admin",
  },
];

export const useCasesByMode: Record<MvpPayoutMode, UseCase[]> = {
  scheduled: [
    {
      id: "trader-rotation",
      title: "Trader rotating contribution",
      description: "A market or trade group's rotating collection. Same engine, each person's turn comes on schedule.",
      payoutMode: "scheduled",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "coop-rotating",
      title: "Cooperative thrift, rotating payout",
      description: "Monthly contributions from every member, paid out to one member at a time in turn.",
      payoutMode: "scheduled",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "installment-purchase",
      title: "Big purchase, paid in installments",
      description:
        "Friends or family pool toward one big buy — a generator, a fridge, a laptop — and pay the vendor in stages, each installment on its own date, independent of the others.",
      payoutMode: "scheduled",
      potType: "private",
      refundType: "contributors",
    },
  ],
  manual: [
    {
      id: "medical-emergency-fund",
      title: "Medical bill emergency fund",
      description: "A sudden diagnosis, an accident, a crisis. Anyone can contribute, no membership required, and a trusted admin releases funds the moment it's needed.",
      payoutMode: "manual",
      potType: "public",
      refundType: "admin",
    },
    {
      id: "urgent-house-fixes",
      title: "Urgent house fixes",
      description: "A burst pipe, a broken generator. One trusted tenant collects and pays the artisan immediately, and every other tenant can see the money move.",
      payoutMode: "manual",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "community-levy",
      title: "Community development levy",
      description: "Estate or street association funding a shared project. Anyone can give.",
      payoutMode: "manual",
      potType: "public",
      refundType: "admin",
    },
    {
      id: "welfare-fund",
      title: "Staff welfare fund",
      description: "HR collects for a colleague in need. Welfare officers approve the payout.",
      payoutMode: "manual",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "group-gift",
      title: "Office or group gift",
      description: "Colleagues pooling for a leaving gift, a birthday, a retirement. Small, quick, single payout.",
      payoutMode: "manual",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "religious-project",
      title: "Church or mosque project fund",
      description: "A unit head pays the vendor once the renovation or equipment fund is ready.",
      payoutMode: "manual",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "travel-fund",
      title: "Travel group fund",
      description: "Everyone pays their share of the trip; refunded to contributors if it falls through.",
      payoutMode: "manual",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "dept-levies",
      title: "University department levies",
      description: "Class rep or course captain collects departmental dues each session and releases funds for materials, events, or projects as needed.",
      payoutMode: "manual",
      potType: "private",
      refundType: "admin",
    },
  ],
  target_based: [
    {
      id: "burial",
      title: "Burial & funeral contributions",
      description: "Family scattered across states, all pooling in. Time-sensitive, locked to a date, paid where the creator directs.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "school-fees",
      title: "School fees emergency pool",
      description: "A WhatsApp group covers a member's fees once enough has come in.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "rent-pooling",
      title: "House rent pooling",
      description: "Roommates splitting rent into one pot. No single person ever holds the money.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "baby-shower",
      title: "Baby shower & naming ceremony",
      description: "Friends chipping in for a gift or the event itself. Locked to an amount or a date.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "startup-capital",
      title: "Startup capital among friends",
      description: "Friends co-funding a business idea. Refunded to everyone if the target isn't reached.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "capital-calls",
      title: "Business partner capital calls",
      description: "Partners each commit a fixed amount. Fires only once everyone's contribution is in.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
  ],
  recurring: [
    {
      id: "tenants-levy",
      title: "Landlord & tenants association levy",
      description: "Monthly estate costs like security, generator, and borehole, paid automatically.",
      payoutMode: "recurring",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "fellowship-dues",
      title: "Fellowship & campus ministry dues",
      description: "Weekly or monthly dues, paid straight to the ministry account, on schedule.",
      payoutMode: "recurring",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "market-dues",
      title: "Market & trade association dues",
      description: "Traders' recurring dues, paid out without anyone chasing receipts.",
      payoutMode: "recurring",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "coop-thrift",
      title: "Cooperative thrift (SACCO-style)",
      description: "Formal cooperative contributions, paid out on the society's own calendar.",
      payoutMode: "recurring",
      potType: "private",
      refundType: "admin",
    },
  ],
};
