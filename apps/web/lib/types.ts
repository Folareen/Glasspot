// Wire response/input types, mirroring apps/backend's Zod schemas
// (apps/backend/src/modules/{auth,me,banks,pots}/*.schema.ts). apps/web has no
// dependency on apps/backend, so these are hand-copied rather than imported —
// keep them in sync by hand if the backend schemas change shape.
//
// Every money field below (minContribution, maxContribution, goalAmount,
// balance, amount, expectedAmount, targetAmount) is a naira string with
// exactly two decimal places ("100.50"), never a kobo integer — see
// docs/system-rules.md's money rule and lib/money.ts.

export type PayoutMode = "target_based" | "manual" | "recurring" | "scheduled";
export type PotType = "public" | "private";
export type PotStatus = "draft" | "open" | "closed";
export type RefundType = "admin" | "contributors";
export type PotMemberRole = "admin" | "member";

export type ContributionStatus = "pending" | "funded" | "underpaid" | "failed" | "reversed";

export type TransactionType =
  | "funding"
  | "contribution"
  | "payout"
  | "refund"
  | "fee"
  | "transfer"
  | "reversal";

export type TransactionStatus = "pending" | "processing" | "completed" | "failed" | "reversed";

export type Destination = {
  destinationAccount: string;
  destinationBank: string;
};

// No admin-manual-trigger option: target_based is purely rule-driven,
// fires once via targetDate/targetAmount only. A group wanting
// "fixed destination, admin releases whenever" should pick manual mode
// with a destination set instead — see ManualPayoutConfig below.
export type TargetBasedPayoutConfig = Destination & {
  destinationAccountName: string;
  targetDate: string | null;
  targetAmount: string | null;
  fired: boolean;
};

// Manual mode's destination is optional. If unset (all three fields null),
// the group's agreed rule is that any admin can send the balance to
// whichever account they choose at the moment they trigger it — the
// destination is recorded on the resulting transaction instead, so it
// stays visible to everyone after the fact even though it wasn't locked in
// at creation. If set, it acts as a fixed default destination instead —
// repeatable indefinitely, unlike target_based's single fire.
export type ManualPayoutConfig = {
  destinationAccount: string | null;
  destinationBank: string | null;
  destinationAccountName: string | null;
};

export type RecurringPayoutConfig = Destination & {
  destinationAccountName: string;
  amount: string;
  intervalDays: number;
  nextRunAt: string;
};

export type ScheduledLeg = Destination & {
  destinationAccountName: string;
  sequenceOrder: number;
  amount: string;
  scheduledDate: string;
  fired: boolean;
};

export type ScheduledPayoutConfig = {
  ordered: boolean;
  legs: ScheduledLeg[];
};

export type PayoutConfig =
  | TargetBasedPayoutConfig
  | ManualPayoutConfig
  | RecurringPayoutConfig
  | ScheduledPayoutConfig;

// Request-side shapes for POST /pots and PATCH /pots/:id — distinct from the response types
// above (no destinationAccountName/fired, since those are server-computed/server-owned; dates are
// sent as ISO strings and re-returned as ISO strings so no separate wire format is needed there).
// Mirrors apps/backend/src/modules/pots/pots.schema.ts's targetBasedPayoutConfigSchema /
// manualPayoutConfigSchema / recurringPayoutConfigSchema / scheduledPayoutConfigSchema.
export type TargetBasedPayoutConfigInput = Destination & {
  targetDate?: string;
  targetAmount?: string;
};

export type ManualPayoutConfigInput = Partial<Destination>;

export type RecurringPayoutConfigInput = Destination & {
  amount: string;
  intervalDays: number;
  nextRunAt: string;
};

export type ScheduledLegInput = Destination & {
  sequenceOrder: number;
  amount: string;
  scheduledDate: string;
};

export type ScheduledPayoutConfigInput = {
  ordered: boolean;
  legs: ScheduledLegInput[];
};

export type PayoutConfigInput =
  | TargetBasedPayoutConfigInput
  | ManualPayoutConfigInput
  | RecurringPayoutConfigInput
  | ScheduledPayoutConfigInput;

export type PotResponse = {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  potType: PotType;
  status: PotStatus;
  payoutMode: PayoutMode;
  // null for manual mode with no fixed destination configured (no config row was ever inserted —
  // see manualPayoutConfigs' comment); a real PayoutConfig object for every other case, including
  // manual mode WITH a fixed destination. See PotsService.getPayoutConfig/serializePayoutConfig.
  payoutConfig: PayoutConfig | null;
  refundType: RefundType;
  shareSlug: string;
  minContribution: string;
  maxContribution: string | null;
  // Optional, display-only fundraising goal for ANY payout mode — purely
  // informational, never read by trigger/payout logic. Distinct from
  // target_based's payoutConfig.targetAmount, which actually fires a
  // payout once reached.
  goalAmount: string | null;
  balance: string;
  pendingOperation: "payout" | "refund" | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemberResponse = {
  id: string;
  potId: string;
  userId: string;
  role: PotMemberRole;
  invitedByUserId: string | null;
  joinedAt: string;
  fullName: string;
  username: string;
  email: string;
};

export type InviteResponse = {
  id: string;
  potId: string;
  email: string;
  role: PotMemberRole;
  status: "pending" | "accepted" | "cancelled";
  invitedByUserId: string;
  acceptedUserId: string | null;
  createdAt: string;
  acceptedAt: string | null;
};

export type AddMemberResponse = MemberResponse | Omit<InviteResponse, "acceptedUserId" | "acceptedAt">;

export type TransactionResponse = {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  reference: string;
  externalReference: string | null;
  amount: string;
  createdAt: string;
};

export type MeTransaction = TransactionResponse & {
  potId: string;
  potTitle: string;
};

export type ContributionResponse = {
  id: string;
  potId: string;
  // null for an anonymous, unauthenticated contribution to a public pot.
  contributorUserId: string | null;
  virtualAccountRef: string;
  virtualAccountNumber: string | null;
  expectedAmount: string;
  status: ContributionStatus;
  anonymous: boolean;
  refundAccountNumber: string | null;
  refundAccountName: string | null;
  refundBank: string | null;
  transactionId: string | null;
  createdAt: string;
  expiresAt: string;
  fundedAt: string | null;
};

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  phone: string | null;
  defaultRefundAccount: string | null;
  defaultRefundBank: string | null;
};

export type Bank = {
  code: string;
  name: string;
};

export type BankLookupResult = {
  accountNumber: string;
  bankCode: string;
  accountName: string;
};
