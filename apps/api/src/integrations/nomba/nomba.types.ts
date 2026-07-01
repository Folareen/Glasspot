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
}