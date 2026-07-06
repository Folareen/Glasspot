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

/**
 * Payout or pot-level refund — money already recognized in the ledger.
 *
 * contributorUserId is metadata only (tags which real user a fan-out leg
 * belongs to, when there is one) — it is NOT the signal for whether this
 * job is one leg of a multi-leg fan-out refund, since an anonymous
 * contributor's leg has no contributorUserId at all but is still one of
 * N legs sharing a pot-level lock. isFanOutLeg carries that distinction
 * explicitly instead, so the worker's lock-release logic (decrement vs.
 * clear) can't misfire on an anonymous leg (see releaseLock in worker.ts).
 */
interface LedgerDisbursementJobData extends BaseDisbursementJobData {
  kind: "payout" | "pot_refund";
  potId: string;
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