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
 * Payout or pot-level refund — money already recognized in the ledger. `kind` is split into two
 * distinct branches (not one field typed "payout" | "pot_refund") so Extract<DisbursementJobData,
 * { kind: 'payout' }> actually narrows instead of resolving to `never` — a single field whose own
 * type is itself a union can never be assignable to a single literal, which is exactly what
 * Extract's distribution check requires.
 */
interface LedgerDisbursementJobDataBase extends BaseDisbursementJobData {
  potId: string;
  // contributorUserId is metadata only (tags the real user a fan-out leg belongs to, if any) — NOT the signal for
  // whether this is one leg of a multi-leg fan-out refund, since anonymous legs have no contributorUserId but are
  // still one of N legs sharing a pot-level lock. isFanOutLeg carries that distinction so the worker's lock-release
  // logic (decrement vs. clear) can't misfire on an anonymous leg (see releaseLock in worker.ts).
  contributorUserId?: string;
  isFanOutLeg?: boolean;
  onSuccess?: DisbursementOnSuccess;
}

type PayoutJobData = LedgerDisbursementJobDataBase & { kind: "payout" };
type PotRefundJobData = LedgerDisbursementJobDataBase & { kind: "pot_refund" };

/**
 * Refunding one inbound contribution payment from an expired, never-funded contribution. `amount`
 * is already fee-adjusted by ExpiryService (the sender's original payment minus OUTBOUND_FEE) —
 * still posts a ledger transaction (debiting `suspense`, via expiryRefundLegs), same as every
 * other outbound transfer, just against no pot/platform_float balance since this payment was never
 * credited to a pot.
 */
interface ContributionRefundJobData extends BaseDisbursementJobData {
  kind: "contribution_refund";
  contributionId: string;
  contributionPaymentId: string;
}

export type DisbursementJobData = PayoutJobData | PotRefundJobData | ContributionRefundJobData;