// Mirrors the wire response/input types from apps/backend's Zod schemas
// (apps/backend/src/modules/{auth,pots}/*.schema.ts). apps/web has no
// dependency on apps/backend, so these are hand-copied rather than imported —
// keep them in sync by hand if the backend schemas change shape.

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

export type TargetBasedPayoutConfig = Destination & {
  targetDate?: string;
  targetAmountKobo?: string;
  adminManualEnabled?: boolean;
};

// Manual mode carries no pre-set destination: the group's agreed rule is
// that any admin can send the balance to whichever account they choose
// at the moment they trigger it. The destination is recorded on the
// resulting transaction instead, so it stays visible to everyone after
// the fact even though it wasn't locked in at creation.
export type ManualPayoutConfig = Record<string, never>;

export type RecurringPayoutConfig = Destination & {
  amountKobo: string;
  intervalDays: number;
  nextRunAt: string;
};

export type ScheduledLeg = Destination & {
  sequenceOrder: number;
  amountKobo: string;
  scheduledDate: string;
  firedAt?: string | null;
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

export type PotResponse = {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  potType: PotType;
  status: PotStatus;
  payoutMode: PayoutMode;
  payoutConfig: PayoutConfig;
  refundType: RefundType;
  shareSlug: string;
  minContributionKobo: string;
  maxContributionKobo: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Demo-only derived fields (not on the real wire type) used to render
  // list/detail views without recomputing from a full ledger each time.
  balanceKobo: string;
  pendingOperation: "payout" | "refund" | null;
};

export type MemberResponse = {
  id: string;
  potId: string;
  userId: string;
  role: PotMemberRole;
  invitedByUserId: string | null;
  joinedAt: string;
  // Demo-only display fields.
  fullName: string;
  username: string;
};

export type TransactionResponse = {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  reference: string;
  externalReference: string | null;
  amountKobo: string;
  createdAt: string;
  // Demo-only display fields.
  potId: string;
  potTitle: string;
  destinationAccount?: string;
  destinationBank?: string;
};

export type ContributionResponse = {
  id: string;
  potId: string;
  contributorUserId: string;
  virtualAccountRef: string;
  virtualAccountNumber: string | null;
  expectedAmountKobo: string;
  paidAmountKobo: string;
  status: ContributionStatus;
  anonymous: boolean;
  refundAccountNumber: string | null;
  refundAccountName: string | null;
  refundBank: string | null;
  transactionId: string | null;
  createdAt: string;
  expiresAt: string;
  fundedAt: string | null;
  // Demo-only display fields.
  contributorName: string;
};

export type CommentResponse = {
  id: string;
  potId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  defaultRefundAccount: string | null;
  defaultRefundBank: string | null;
};
