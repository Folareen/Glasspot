// Mirrors packages/db/src/schema/pots.ts enums. `scheduled` exists on the
// real payoutModeEnum but is not part of this MVP build (see docs/spec-mvp.md),
// so it's excluded from MvpPayoutMode and never appears in demo data.
export type MvpPayoutMode = "target_based" | "manual" | "recurring" | "rotation";
export type PayoutMode = MvpPayoutMode | "scheduled";
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

export const payoutModeMeta: Record<MvpPayoutMode, { label: string; description: string }> = {
  target_based: {
    label: "Hits a target",
    description: "Pays out to one destination once an amount or date is reached, or an admin triggers it early.",
  },
  rotation: {
    label: "Takes turns",
    description: "Pays each member in turn, on their own schedule: ajo/esusu, run by the app instead of by memory.",
  },
  recurring: {
    label: "On a schedule",
    description: "Pays the same amount, to the same destination, on a fixed interval, until the pot closes.",
  },
  manual: {
    label: "Trusted trigger",
    description: "Pays out whenever an admin triggers it, no condition attached, but always logged for the pot to see.",
  },
};

export const potTypeBadge: Record<PotType, string> = {
  public: "Public",
  private: "Private",
};

export const refundTypeBadge: Record<RefundType, string> = {
  admin: "Refunds via admin",
  contributors: "Refunds to contributors",
};

export const featuredUseCases: UseCase[] = [
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
    id: "rotating-ajo",
    title: "Rotating ajo / esusu",
    description:
      "The same trusted circle, run properly. Everyone contributes every round, and each member is paid in turn, on schedule, automatically.",
    payoutMode: "rotation",
    potType: "private",
    refundType: "contributors",
  },
  {
    id: "weddings",
    title: "Weddings & ceremonies",
    description:
      "Office colleagues, family, or friends pooling for a couple's big day. Locked to a date or amount, paid to the couple, refunded to contributors if the target isn't met.",
    payoutMode: "target_based",
    potType: "private",
    refundType: "contributors",
  },
  {
    id: "hostel-dues",
    title: "Hostel & association dues",
    description:
      'Same amount, same date, every month, for generator fuel, cleaning, security. Set it once and it fires on its own. No more chasing people, no more "oga I sent it".',
    payoutMode: "recurring",
    potType: "private",
    refundType: "admin",
  },
];

export const useCasesByMode: Record<MvpPayoutMode, UseCase[]> = {
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
      id: "baby-shower",
      title: "Baby shower & naming ceremony",
      description: "Friends chipping in for a gift or the event itself. Locked to an amount or a date.",
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
      id: "startup-capital",
      title: "Startup capital among friends",
      description: "Friends co-funding a business idea. Refunded to everyone if the target isn't reached.",
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
      id: "capital-calls",
      title: "Business partner capital calls",
      description: "Partners each commit a fixed amount. Fires only once everyone's contribution is in.",
      payoutMode: "target_based",
      potType: "private",
      refundType: "contributors",
    },
  ],
  rotation: [
    {
      id: "trader-rotation",
      title: "Trader rotating contribution",
      description: "A market or trade group's rotating collection. Same engine, each person's turn comes on schedule.",
      payoutMode: "rotation",
      potType: "private",
      refundType: "contributors",
    },
    {
      id: "coop-rotating",
      title: "Cooperative thrift, rotating payout",
      description: "Monthly contributions from every member, paid out to one member at a time in turn.",
      payoutMode: "rotation",
      potType: "private",
      refundType: "contributors",
    },
  ],
  recurring: [
    {
      id: "fellowship-dues",
      title: "Fellowship & campus ministry dues",
      description: "Weekly or monthly dues, paid straight to the ministry account, on schedule.",
      payoutMode: "recurring",
      potType: "private",
      refundType: "admin",
    },
    {
      id: "tenants-levy",
      title: "Landlord & tenants association levy",
      description: "Monthly estate costs like security, generator, and borehole, paid automatically.",
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
    {
      id: "market-dues",
      title: "Market & trade association dues",
      description: "Traders' recurring dues, paid out without anyone chasing receipts.",
      payoutMode: "recurring",
      potType: "private",
      refundType: "admin",
    },
  ],
  manual: [
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
      id: "travel-fund",
      title: "Travel group fund",
      description: "Everyone pays their share of the trip; refunded to contributors if it falls through.",
      payoutMode: "manual",
      potType: "private",
      refundType: "contributors",
    },
  ],
};
