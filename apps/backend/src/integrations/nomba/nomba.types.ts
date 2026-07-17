import { WebhookIdStore } from "@/integrations/nomba/webhooks";
import { BankStore } from "@/integrations/nomba/bank-store";

type Environment = "production" | "sandbox";

export const BASE_URLS: Record<Environment, string> = {
  production: "https://api.nomba.com",
  sandbox: "https://sandbox.nomba.com",
};


export interface Bank {
  code: string;
  name: string;
}

export interface BankAccountLookupResult {
  accountNumber: string;
  accountName: string;
}

export interface TransferParams {
  /** Naira, NOT kobo — e.g. 3500 for ₦3,500. Nomba's transfer endpoint takes a decimal naira amount; convert from an internal kobo bigint via koboToNairaString (apps/backend/src/lib/money.ts) before calling. */
  amountNaira: number;
  accountNumber: string;
  /** confirm this with lookupBankAccount() before calling */
  accountName: string;
  bankCode: string;
  /** idempotency key - must be unique per transaction */
  merchantTxRef: string;
  senderName: string;
  narration?: string;
}

/** SUCCESS/PENDING_BILLING are the "fine" outcomes; the rest are failure codes; REFUND means Nomba already auto-reversed it, safe to retry with a new merchantTxRef. */
export type TransferStatus =
  | "SUCCESS"
  | "PENDING_BILLING"
  | "FAILED"
  | "BAD_REQUEST"
  | "INSUFFICIENT_BALANCE"
  | "ACCOUNT_NOT_FOUND"
  | "INVALID_TRANSACTION"
  | "WALLET_NOT_FOUND"
  | "BLACKLISTED"
  | "REFUND";

export interface TransferResult {
  id: string;
  // The full TransferStatus union, not just the "fine" outcomes — a 2xx HTTP response can still
  // carry a failure code in the body (see transferToBankAccount's own doc comment), and callers
  // must branch on all of them, not just 'SUCCESS'.
  status: TransferStatus;
  /** Naira, as returned by Nomba — not kobo. */
  amount: string;
  fee: number;
  timeCreated: string;
  [key: string]: unknown;
}

export interface CreateVirtualAccountParams {
  /** 16-64 chars, unique per account you issue */
  accountRef: string;
  /** 8-64 chars */
  accountName: string;
  bvn?: string;
  expiryDate?: string;
  /** Naira, NOT kobo — e.g. 3500 for ₦3,500. Convert from an internal kobo bigint via koboToNairaString (apps/backend/src/lib/money.ts) before calling. */
  expectedAmountNaira?: number;
}

export interface VirtualAccount {
  createdAt: string;
  accountHolderId: string;
  accountRef: string;
  accountName: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  currency: "NGN";
  [key: string]: unknown;
}

export interface Transaction {
  id: string;
  status: string;
  /** Naira, as returned by Nomba — not kobo. */
  amount: number;
  merchantTxRef?: string;
  [key: string]: unknown;
}

/** Every event_type Nomba's webhook sends; all six share one { merchant, terminal, transaction, customer } envelope — only which transaction fields are populated differs. */
export const NOMBA_WEBHOOK_EVENT_TYPES = [
  "payment_success",
  "payment_failed",
  "payment_reversal",
  "payout_success",
  "payout_failed",
  "payout_refund",
] as const;
export type NombaWebhookEventType = (typeof NOMBA_WEBHOOK_EVENT_TYPES)[number];

export interface WebhookEvent<T = any> {
  event_type: NombaWebhookEventType;
  requestId: string;
  data: T;
}

export interface NombaClientConfig {
  clientId: string;
  clientSecret: string;
  /** parent accountId of the business - sent as the `accountId` header on every call */
  accountId: string;
  /** the sub-account money actually lives in and transfers out of - see transferToBankAccount() */
  subAccountId: string;
  environment?: Environment;
  /** required only if you'll verify webhooks */
  webhookSecret?: string;
  webhookSignatureHeader?: string; // default: "signature"
  /** defaults to an in-memory store; pass a Redis/DB-backed one in production */
  webhookIdStore?: WebhookIdStore;
  /** optional cache-forever store for fetchBankCodes(); omit to skip caching entirely */
  bankStore?: BankStore;
  businessName?: string;
  requestTimeoutMs?: number;
}


/**
 * The single `data` shape shared by all six webhook event types. payment_success/failed/reversal
 * (virtual account funding) set aliasAccountNumber/Name/Type/Reference, never merchantTxRef.
 * payout_success/failed/refund (our own transfer calls) set merchantTxRef — the correlation key
 * back to our own transaction — never aliasAccount*. Narrow by event_type at the call site, not
 * by which fields happen to be present.
 */
export interface WebhookTransactionData {
  merchant: { walletId: string; walletBalance: number; userId: string };
  transaction: {
    transactionId: string;
    /** Naira, as sent by Nomba — not kobo. Convert to an internal kobo bigint via nairaStringToKobo(transactionAmount.toFixed(2)) (apps/backend/src/lib/money.ts), never Math.round(transactionAmount * 100) directly on the float. */
    transactionAmount: number;
    fee: number;
    type: string;
    time: string;
    responseCode?: string;
    originatingFrom?: string;
    narration?: string;
    sessionId?: string;
    // payment_* (virtual account funding) only:
    aliasAccountNumber?: string;
    aliasAccountName?: string;
    aliasAccountType?: string; // "VIRTUAL" for virtual-account funding
    aliasAccountReference?: string;
    // payout_* (our transferToBankAccount() calls) only:
    merchantTxRef?: string;
    [key: string]: unknown;
  };
  customer?: {
    senderName?: string;
    recipientName?: string;
    accountNumber?: string;
    bankCode?: string;
    bankName?: string;
  };
}

// ---------------------------------------------------------------
// Reconciliation types
// ---------------------------------------------------------------
 
export type ReconciliationStatus = "matched" | "overpaid" | "underpaid" | "orphan" | "missing_on_nomba";


/** Your local ledger's view of a payment, keyed by merchantTxRef. */
export interface LocalPaymentRecord {
  amount: number;
  /** used to group the report by customer - omit if you don't track this */
  customerId?: string;
  [key: string]: unknown;
}
 
export interface ReconciliationLineItem {
  status: ReconciliationStatus;
  merchantTxRef: string;
  customerId?: string;
  nombaAmount?: number;
  localAmount?: number;
  /** nombaAmount - localAmount, when both are known. Positive = overpaid (received more than expected), negative = underpaid (received less). */
  difference?: number;
  nombaTransaction?: Transaction;
}
 
export interface CustomerReconciliationSummary {
  customerId: string;
  expectedTotal: number;
  receivedTotal: number;
  overpaidTotal: number;
  underpaidTotal: number;
  lineItems: ReconciliationLineItem[];
}
 
export interface ReconciliationReport {
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  totalChecked: number;
  matchedCount: number;
  overpaidCount: number;
  underpaidCount: number;
  orphanCount: number;
  missingOnNombaCount: number;
  lineItems: ReconciliationLineItem[];
  /** grouped by customerId; entries with no customerId are grouped under "unknown" */
  byCustomer: CustomerReconciliationSummary[];
}