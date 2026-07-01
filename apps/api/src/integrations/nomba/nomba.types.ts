import { WebhookIdStore } from "./webhooks.js";

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
  amount: number;
  accountNumber: string;
  /** confirm this with lookupBankAccount() before calling */
  accountName: string;
  bankCode: string;
  /** idempotency key - must be unique per transaction */
  merchantTxRef: string;
  senderName: string;
  narration?: string;
}

/**
 * SUCCESS / PENDING_BILLING are the two "everything is fine" outcomes (see
 * transferToBankAccount doc comment). FAILED/BAD_REQUEST/INSUFFICIENT_BALANCE/
 * ACCOUNT_NOT_FOUND/INVALID_TRANSACTION/WALLET_NOT_FOUND/BLACKLISTED are
 * documented failure codes. REFUND means the transfer failed and Nomba has
 * already auto-reversed it back to your account - safe to retry with a new
 * merchantTxRef.
 */
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
  status: "SUCCESS" | "PENDING_BILLING";
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
  expectedAmount?: number;
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
  amount: number;
  merchantTxRef?: string;
  [key: string]: unknown;
}

export interface WebhookEvent<T = any> {
  event_type: string;
  requestId: string;
  data: T;
}

export interface NombaClientConfig {
  clientId: string;
  clientSecret: string;
  /** parent accountId of the business - sent as the `accountId` header on every call */
  accountId: string;
  environment?: Environment;
  /** required only if you'll verify webhooks */
  webhookSecret?: string;
  webhookSignatureHeader?: string; // default: "signature"
  /** defaults to an in-memory store; pass a Redis/DB-backed one in production */
  webhookIdStore?: WebhookIdStore;
  businessName?: string;
  requestTimeoutMs?: number;
}


/** Payload shape for a virtual account funding notification (event_type "payment_success"). */
export interface VirtualAccountPaymentData {
  merchant: { walletId: string; walletBalance: number; userId: string };
  transaction: {
    aliasAccountNumber: string;
    aliasAccountName: string;
    aliasAccountType: string; // "VIRTUAL" for virtual-account funding
    transactionId: string;
    transactionAmount: number;
    fee: number;
    narration: string;
    time: string;
    type: string;
    [key: string]: unknown;
  };
  customer: {
    senderName: string;
    accountNumber: string;
    bankCode: string;
    bankName: string;
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