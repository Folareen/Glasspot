// src/modules/scheduler/disbursement-job.types.ts

export type DisbursementOnSuccess =
  | { type: "mark_target_based_fired"; targetConfigId: string }
  | { type: "advance_recurring_next_run_at"; recurringConfigId: string }
  | { type: "mark_scheduled_leg_fired"; scheduledLegId: string };

export type DisbursementKind = "payout" | "pot_refund" | "contribution_refund";

interface BaseDisbursementJobData {
  amount: string; // kobo integer; bigint travels as string over JSON — see prior note
  destinationAccount: string;
  destinationBank: string;
  reference: string;
}

/** Payout or pot-level refund — money already recognized in the ledger. */
interface LedgerDisbursementJobData extends BaseDisbursementJobData {
  kind: "payout" | "pot_refund";
  potId: string;
  // contributorUserId is metadata only (tags the real user a fan-out leg belongs to, if any) — NOT the signal for
  // whether this is one leg of a multi-leg fan-out refund, since anonymous legs have no contributorUserId but are
  // still one of N legs sharing a pot-level lock. isFanOutLeg carries that distinction so the worker's lock-release
  // logic (decrement vs. clear) can't misfire on an anonymous leg (see releaseLock in worker.ts).
  contributorUserId?: string;
  isFanOutLeg?: boolean;
  onSuccess?: DisbursementOnSuccess;
}

/** Refunding one inbound contribution payment — never touched the ledger. */
interface ContributionRefundJobData extends BaseDisbursementJobData {
  kind: "contribution_refund";
  contributionId: string;
  contributionPaymentId: string;
}

export type DisbursementJobData = LedgerDisbursementJobData | ContributionRefundJobData;