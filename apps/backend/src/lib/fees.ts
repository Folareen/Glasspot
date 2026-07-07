import type { LedgerEntryInput } from "@/modules/ledger/ledger.service";

/**
 * Nomba's real, confirmed-flat cost per virtual-account collection, and Glasspot's own cut on
 * top of it — see docs/system-rules.md's fee section. Both charged to the contributor, added on
 * top of the amount they intend to contribute, so the pot always receives exactly that intended
 * amount regardless of the fee split.
 */
export const NOMBA_INBOUND_FEE = 1000n;
export const PLATFORM_INBOUND_FEE = 1000n;
export const INBOUND_FEE = NOMBA_INBOUND_FEE + PLATFORM_INBOUND_FEE;

/**
 * Nomba's real, confirmed-flat cost per bank transfer (payout/refund), and Glasspot's own cut on
 * top of it. Charged to the pot, added on top of the amount the recipient is meant to receive, so
 * the recipient always gets exactly that amount — see pots.service.ts's postFixedAmountDisbursement.
 */
export const NOMBA_OUTBOUND_FEE = 2000n;
export const PLATFORM_OUTBOUND_FEE = 3000n;
export const OUTBOUND_FEE = NOMBA_OUTBOUND_FEE + PLATFORM_OUTBOUND_FEE;

/**
 * The 4-leg split for a funded contribution. platformFloat (debit-normal) is debited the gross
 * amount that nominally settles through Nomba — intendedAmount + NOMBA_INBOUND_FEE — because
 * Nomba's cut is taken out of that same inflow, never out of a separate pool. nombaClearing
 * (credit-normal) is credited exactly NOMBA_INBOUND_FEE as the matching contra-entry for
 * nombaFeeExpense's debit, representing the slice of that gross inflow that never actually
 * becomes usable float balance (Nomba keeps it). pot is credited the intended net amount, and
 * platformRevenue is credited the platform's own cut.
 *
 * Netting platformFloat's two roles here (gross debit minus what's carved out via nombaClearing)
 * would double-book the Nomba fee, so nombaClearing is posted as its own separate account rather
 * than a second leg against platformFloat — see docs/system-rules.md's fee-accounting section for
 * the worked arithmetic proving this balances.
 */
export function inboundFeeLegs(accounts: {
  platformFloatId: string;
  potAccountId: string;
  platformRevenueId: string;
  nombaFeeExpenseId: string;
  nombaClearingId: string;
}, intendedAmount: bigint): LedgerEntryInput[] {
  return [
    { accountId: accounts.platformFloatId, direction: "debit", amount: intendedAmount + NOMBA_INBOUND_FEE },
    { accountId: accounts.potAccountId, direction: "credit", amount: intendedAmount },
    { accountId: accounts.platformRevenueId, direction: "credit", amount: PLATFORM_INBOUND_FEE },
    { accountId: accounts.nombaFeeExpenseId, direction: "debit", amount: NOMBA_INBOUND_FEE },
    { accountId: accounts.nombaClearingId, direction: "credit", amount: NOMBA_INBOUND_FEE },
  ];
}

/**
 * The 4-leg split for an outbound payout/refund — the exact mirror of inboundFeeLegs. pot
 * (credit-normal) is debited recipientAmount + OUTBOUND_FEE, its full drawdown. platformFloat
 * (debit-normal) is credited recipientAmount + NOMBA_OUTBOUND_FEE — the gross cash movement
 * toward the transfer, since Nomba's cut is taken out of that same outflow, mirroring how the
 * inbound side's float debit absorbs the Nomba fee into its gross figure. nombaClearing is
 * credited exactly NOMBA_OUTBOUND_FEE as the contra-entry for nombaFeeExpense's debit, same
 * direction as inboundFeeLegs so nombaClearing accumulates as a running total across both
 * directions. platformRevenue is credited the platform's own cut.
 */
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
