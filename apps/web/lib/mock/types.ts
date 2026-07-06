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

// No admin-manual-trigger option: target_based is purely rule-driven,
// fires once via targetDate/targetAmount only. A group wanting
// "fixed destination, admin releases whenever" should pick manual mode
// with a destination set instead — see ManualPayoutConfig below.
export type TargetBasedPayoutConfig = Destination & {
  targetDate?: string;
  targetAmount?: string;
};

// Manual mode's destination is optional. If unset, the group's agreed
// rule is that any admin can send the balance to whichever account they
// choose at the moment they trigger it — the destination is recorded on
// the resulting transaction instead, so it stays visible to everyone
// after the fact even though it wasn't locked in at creation. If set, it
// acts as a fixed default destination instead — repeatable indefinitely,
// unlike target_based's single fire.
export type ManualPayoutConfig = Partial<Destination>;

export type RecurringPayoutConfig = Destination & {
  amount: string;
  intervalDays: number;
  nextRunAt: string;
};

export type ScheduledLeg = Destination & {
  sequenceOrder: number;
  amount: string;
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
  minContribution: string;
  maxContribution: string | null;
  // Optional, display-only fundraising goal for ANY payout mode — purely
  // informational, never read by trigger/payout logic. Distinct from
  // target_based's payoutConfig.targetAmount, which actually fires a
  // payout once reached.
  goalAmount: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Both real wire fields: balance is the pot's current ledger
  // balance (server-computed, see PotsService.getBalance), pendingOperation
  // mirrors the pots.pending_operation column.
  balance: string;
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
  amount: string;
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
  // null for an anonymous, unauthenticated contribution to a public pot.
  contributorUserId: string | null;
  virtualAccountRef: string;
  virtualAccountNumber: string | null;
  expectedAmount: string;
  paidAmount: string;
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

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  defaultRefundAccount: string | null;
  defaultRefundBank: string | null;
};
