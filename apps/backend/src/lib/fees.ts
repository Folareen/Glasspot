import type { LedgerEntryInput } from "@/modules/ledger/ledger.service";

/** Nomba's real virtual-account collection cost for a given intended contribution amount — 1% truncated down, floored at ₦10, capped at ₦150 (see docs/system-rules.md's fee section). */
const NOMBA_INBOUND_FEE_RATE_BPS = 100n; // 1% = 100 basis points out of 10_000
export const NOMBA_INBOUND_FEE_MIN = 1000n; // ₦10
export const NOMBA_INBOUND_FEE_MAX = 15000n; // ₦150
export const PLATFORM_INBOUND_FEE = 1000n; // ₦10, flat

/** Nomba's inbound cut for a given intended contribution amount — the one place this formula is evaluated. */
export function nombaInboundFeeFor(intendedAmount: bigint): bigint {
  const raw = (intendedAmount * NOMBA_INBOUND_FEE_RATE_BPS) / 10_000n; // truncates down, never rounds up
  if (raw < NOMBA_INBOUND_FEE_MIN) return NOMBA_INBOUND_FEE_MIN;
  if (raw > NOMBA_INBOUND_FEE_MAX) return NOMBA_INBOUND_FEE_MAX;
  return raw;
}

/** Total inbound fee (Nomba's cut plus the platform's flat cut) for a given intended amount. */
export function inboundFeeFor(intendedAmount: bigint): bigint {
  return nombaInboundFeeFor(intendedAmount) + PLATFORM_INBOUND_FEE;
}

/** Nomba's flat cost per bank transfer (payout/refund), and the platform's own flat cut on top. */
export const NOMBA_OUTBOUND_FEE = 2000n;
export const PLATFORM_OUTBOUND_FEE = 3000n;
export const OUTBOUND_FEE = NOMBA_OUTBOUND_FEE + PLATFORM_OUTBOUND_FEE;

/** The 4-leg split for a funded contribution: pot credited the intended net amount, platformRevenue credited the platform's cut, nombaFeeExpense/nombaClearing recognizing Nomba's cut as a self-cancelling contra-pair. */
export function inboundFeeLegs(accounts: {
  platformFloatId: string;
  potAccountId: string;
  platformRevenueId: string;
  nombaFeeExpenseId: string;
  nombaClearingId: string;
}, intendedAmount: bigint): LedgerEntryInput[] {
  const nombaFee = nombaInboundFeeFor(intendedAmount);
  return [
    // platformFloat gets intendedAmount + PLATFORM_INBOUND_FEE, not + nombaFee — Nomba's own cut
    // never becomes usable platform float, and debits/credits only balance this way once the two
    // fees can differ (see nombaInboundFeeFor).
    { accountId: accounts.platformFloatId, direction: "debit", amount: intendedAmount + PLATFORM_INBOUND_FEE },
    { accountId: accounts.potAccountId, direction: "credit", amount: intendedAmount },
    { accountId: accounts.platformRevenueId, direction: "credit", amount: PLATFORM_INBOUND_FEE },
    { accountId: accounts.nombaFeeExpenseId, direction: "debit", amount: nombaFee },
    { accountId: accounts.nombaClearingId, direction: "credit", amount: nombaFee },
  ];
}

/** The 4-leg split for an outbound payout/refund: pot debited its full drawdown, platformFloat credited the gross transfer amount, platformRevenue credited the platform's cut, nombaFeeExpense/nombaClearing as the contra-pair for Nomba's cut. */
export function outboundFeeLegs(accounts: {
  potAccountId: string;
  platformFloatId: string;
  platformRevenueId: string;
  nombaFeeExpenseId: string;
  nombaClearingId: string;
}, recipientAmount: bigint): LedgerEntryInput[] {
  return [
    { accountId: accounts.potAccountId, direction: "debit", amount: recipientAmount + OUTBOUND_FEE },
    { accountId: accounts.platformFloatId, direction: "credit", amount: recipientAmount + NOMBA_OUTBOUND_FEE },
    { accountId: accounts.platformRevenueId, direction: "credit", amount: PLATFORM_OUTBOUND_FEE },
    { accountId: accounts.nombaFeeExpenseId, direction: "debit", amount: NOMBA_OUTBOUND_FEE },
    { accountId: accounts.nombaClearingId, direction: "credit", amount: NOMBA_OUTBOUND_FEE },
  ];
}

/**
 * The 4-leg split for refunding a contribution's overpaid excess: same fee arithmetic as
 * outboundFeeLegs, but debits `suspense` instead of a pot account — the excess was never credited
 * to the pot in the first place (confirmFunding only ever credits `intendedAmount`), so there's no
 * pot balance to draw down here. suspense recognizes cash that passed through without ever being
 * attributed to a pot/platform_float balance. `refundAmount` is what actually reaches the sender
 * (excess minus OUTBOUND_FEE, deducted the same way as every other outbound transfer).
 */
export function overpaymentRefundLegs(accounts: {
  suspenseId: string;
  platformFloatId: string;
  platformRevenueId: string;
  nombaFeeExpenseId: string;
  nombaClearingId: string;
}, refundAmount: bigint): LedgerEntryInput[] {
  return [
    { accountId: accounts.suspenseId, direction: "debit", amount: refundAmount + OUTBOUND_FEE },
    { accountId: accounts.platformFloatId, direction: "credit", amount: refundAmount + NOMBA_OUTBOUND_FEE },
    { accountId: accounts.platformRevenueId, direction: "credit", amount: PLATFORM_OUTBOUND_FEE },
    { accountId: accounts.nombaFeeExpenseId, direction: "debit", amount: NOMBA_OUTBOUND_FEE },
    { accountId: accounts.nombaClearingId, direction: "credit", amount: NOMBA_OUTBOUND_FEE },
  ];
}

/**
 * The 4-leg split for refunding an expired, never-funded contribution's payment (ExpiryService):
 * identical shape and rationale to overpaymentRefundLegs — this payment was never credited to a
 * pot (confirmFunding only posts once accumulated payments reach expectedAmount), so there's no
 * pot balance to draw down, and suspense recognizes the cash the same way. `refundAmount` is what
 * actually reaches the original sender (the payment minus OUTBOUND_FEE).
 */
export function expiryRefundLegs(accounts: {
  suspenseId: string;
  platformFloatId: string;
  platformRevenueId: string;
  nombaFeeExpenseId: string;
  nombaClearingId: string;
}, refundAmount: bigint): LedgerEntryInput[] {
  return [
    { accountId: accounts.suspenseId, direction: "debit", amount: refundAmount + OUTBOUND_FEE },
    { accountId: accounts.platformFloatId, direction: "credit", amount: refundAmount + NOMBA_OUTBOUND_FEE },
    { accountId: accounts.platformRevenueId, direction: "credit", amount: PLATFORM_OUTBOUND_FEE },
    { accountId: accounts.nombaFeeExpenseId, direction: "debit", amount: NOMBA_OUTBOUND_FEE },
    { accountId: accounts.nombaClearingId, direction: "credit", amount: NOMBA_OUTBOUND_FEE },
  ];
}
