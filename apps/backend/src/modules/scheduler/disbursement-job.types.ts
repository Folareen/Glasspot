// src/modules/scheduler/disbursement-job.types.ts

export type DisbursementOnSuccess =
  | { type: "mark_target_based_fired"; targetConfigId: string }
  | { type: "advance_recurring_next_run_at"; recurringConfigId: string }
  | { type: "mark_scheduled_leg_fired"; scheduledLegId: string };

interface LedgerDisbursementJobData extends BaseDisbursementJobData {
  kind: "payout" | "pot_refund";
  potId: string;
  contributorUserId?: string;
  onSuccess?: DisbursementOnSuccess;
}

export type DisbursementKind = "payout" | "pot_refund" | "contribution_refund";

interface BaseDisbursementJobData {
  amountKobo: string; // bigint travels as string over JSON — see prior note
  destinationAccount: string;
  destinationBank: string;
  reference: string;
}

/** Payout or pot-level refund — money already recognized in the ledger. */
interface LedgerDisbursementJobData extends BaseDisbursementJobData {
  kind: "payout" | "pot_refund";
  potId: string;
  contributorUserId?: string; // set for a fan-out pot_refund leg
  onSuccess?: DisbursementOnSuccess;
}

/** Refunding one inbound contribution payment — never touched the ledger. */
interface ContributionRefundJobData extends BaseDisbursementJobData {
  kind: "contribution_refund";
  contributionId: string;
  contributionPaymentId: string;
}

export type DisbursementJobData = LedgerDisbursementJobData | ContributionRefundJobData;