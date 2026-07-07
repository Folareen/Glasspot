/**
 * Nomba API client. Covers auth token issue/refresh, bank list + account lookup, bank transfer
 * and virtual account creation (both sourced from the configured sub-account, never the parent),
 * transaction listing for reconciliation, and webhook signature verification. Requires Node 18+
 * (global fetch); token is cached in memory and refreshed at the 55-minute mark.
 *
 * UNITS: every amount field this client sends to/reads from Nomba is NAIRA (decimal), never kobo
 * (docs/system-rules.md) — convert via koboToNairaString/nairaStringToKobo right at the call
 * site, never earlier, and never store the naira value.
 *
 * REFUNDS: Nomba has no dedicated refund endpoint for virtual account overpayments — the correct
 * mechanism is an outbound transfer back to the sender's bank details from the payment webhook
 * (see refundOverpayment()).
 *
 * WEBHOOKS: six event_types share one payload envelope. payment_success/failed/reversal are
 * virtual-account funding, identified by transaction.aliasAccountNumber, no merchantTxRef.
 * payout_success/failed/refund are outcomes of our own transferToBankAccount() calls, correlated
 * via transaction.merchantTxRef. Nomba doesn't echo back a virtual account's expectedAmount, so
 * compare transaction.transactionAmount against your own stored expectation.
 *
 * SIGNATURE VERIFICATION does not hash the raw body — see handleWebhook()'s doc comment for the
 * exact field order it hashes instead.
 */

import { createHmac, timingSafeEqual } from "crypto";
import {
    NombaClientConfig,
    Bank,
    BankAccountLookupResult,
    TransferParams,
    TransferResult,
    CreateVirtualAccountParams,
    VirtualAccount,
    Transaction,
    WebhookEvent,
    BASE_URLS,
    WebhookTransactionData,
    ReconciliationStatus,
    LocalPaymentRecord,
    ReconciliationLineItem,
    CustomerReconciliationSummary,
    ReconciliationReport
}
from "@/integrations/nomba/nomba.types";

import { NombaApiError } from "@/integrations/nomba/nomba.error";
import { InMemoryWebhookIdStore, WebhookIdStore } from "@/integrations/nomba/webhooks";
import { BankStore } from "@/integrations/nomba/bank-store";


const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** safety valve against an infinite reconcile() loop if Nomba ever returns a cursor that never terminates */
const MAX_RECONCILE_PAGES = 10_000;


export class NombaClient {
  private baseUrl: string;
  private cachedToken: { accessToken: string; refreshToken: string; refreshAt: number } | null = null;
  private webhookIdStore: WebhookIdStore;
  private bankStore?: BankStore;
  private requestTimeoutMs: number;
  /** shared in-flight token request so concurrent callers don't each hit the auth endpoint independently */
  private inFlightTokenRequest: Promise<{ accessToken: string; refreshToken: string; refreshAt: number }> | null =
    null;
  /** shared in-flight bank-list fetch so concurrent cache-miss callers don't each hit Nomba independently */
  private inFlightBanksRequest: Promise<Bank[]> | null = null;


  /** Builds a NombaClient for the configured environment, defaulting webhookIdStore to an in-memory store if none is provided (see webhooks.ts for the Redis-backed alternative). bankStore is optional — without one, fetchBankCodes() just hits Nomba every call uncached. */
  constructor(private config: NombaClientConfig) {
    this.baseUrl = BASE_URLS[config.environment ?? "production"];
    this.webhookIdStore = config.webhookIdStore ?? new InMemoryWebhookIdStore();
    this.bankStore = config.bankStore;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // ---------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------

  /**
   * Returns a cached token, refreshing at the 55-minute mark instead of on
   * every call. Concurrent callers share a single in-flight request instead
   * of each independently hitting the auth endpoint.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.refreshAt) {
      return this.cachedToken.accessToken;
    }

    if (!this.inFlightTokenRequest) {
      this.inFlightTokenRequest = this.fetchNewToken().finally(() => {
        this.inFlightTokenRequest = null;
      });
    }

    const token = await this.inFlightTokenRequest;
    return token.accessToken;
  }

  /** Obtains a fresh access token: refreshes the cached refresh_token if one exists, falling back to a full client_credentials login if the refresh itself fails. */
  private async fetchNewToken() {
    let data: { access_token: string; refresh_token: string; expiresAt: string };

    if (this.cachedToken) {
      try {
        data = await this.post("/v1/auth/token/refresh", {
          grant_type: "refresh_token",
          refresh_token: this.cachedToken.refreshToken,
        });
      } catch {
        // The cached refresh_token itself may now be invalid/expired - fall
        // back to a full client_credentials login instead of getting stuck
        // permanently retrying a refresh that will never succeed.
        data = await this.post("/v1/auth/token/issue", {
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        });
      }
    } else {
      data = await this.post("/v1/auth/token/issue", {
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });
    }

    // Tokens are valid 60 minutes; refresh 5 minutes early. If expiresAt is
    // ever missing/malformed, Date.parse returns NaN and every subsequent
    // "is it still valid" check fails safe (treats it as already expired)
    // rather than caching a token forever.
    this.cachedToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      refreshAt: Date.parse(data.expiresAt) - 5 * 60 * 1000,
    };
    return this.cachedToken;
  }

  // ---------------------------------------------------------------
  // Banks / lookup / transfer
  // ---------------------------------------------------------------

  /**
   * GET /v1/transfers/banks — fetches all bank codes/names. Cached forever
   * (no TTL) via bankStore since bank codes rarely change; call
   * refreshBankCodes() to force a re-fetch after Nomba adds/renames a bank.
   * Concurrent cache-miss callers share one in-flight fetch instead of each
   * hitting Nomba independently.
   */
  async fetchBankCodes(): Promise<Bank[]> {
    const cached = await this.bankStore?.get();
    if (cached) return cached;

    if (!this.inFlightBanksRequest) {
      this.inFlightBanksRequest = this.fetchAndCacheBankCodes().finally(() => {
        this.inFlightBanksRequest = null;
      });
    }
    return this.inFlightBanksRequest;
  }

  /** Clears the cached bank list so the next fetchBankCodes() call re-fetches from Nomba. */
  async refreshBankCodes(): Promise<Bank[]> {
    await this.bankStore?.clear();
    return this.fetchBankCodes();
  }

  private async fetchAndCacheBankCodes(): Promise<Bank[]> {
    // request()'s json.data ?? json already unwraps the envelope - Nomba
    // returns the bank array directly as `data`, not `{ results: [...] }`.
    const banks: Bank[] = await this.get("/v1/transfers/banks");
    await this.bankStore?.set(banks);
    return banks;
  }

  /** POST /v1/transfers/bank/lookup — resolves an account number + bank code to the account holder's name; always call before transferToBankAccount() to confirm the destination. */
  async lookupBankAccount(accountNumber: string, bankCode: string): Promise<BankAccountLookupResult> {
    return this.post("/v1/transfers/bank/lookup", { accountNumber, bankCode });
  }

  /**
   * POST /v2/transfers/bank/{subAccountId} — sourced from the configured sub-account, never the
   * parent. Returns immediately: "SUCCESS" (settled), "PENDING_BILLING" (accepted but not yet
   * settled — rely on the payout_success/failed/refund webhook, never retry with a new
   * reference), or a failure code (Nomba auto-refunds and status becomes "REFUND"; safe to retry
   * with a new merchantTxRef). Nomba caps transfers to the SAME recipient at 5/minute; callers
   * going through the transfers worker get this for free via RedisTransferThrottle — a caller
   * bypassing that worker must throttle per-recipient itself.
   */
  async transferToBankAccount(params: TransferParams): Promise<TransferResult> {
    // Nomba's wire field is "amount" (see developer.nomba.com) — params.amountNaira
    // is this client's own explicit name for the same value (see
    // TransferParams's comment); map it back to Nomba's actual field name here
    // rather than renaming the whole request body.
    const { amountNaira, ...rest } = params;
    return this.post(`/v2/transfers/bank/${encodeURIComponent(this.config.subAccountId)}`, {
      ...rest,
      amount: amountNaira,
    });
  }


  /** Refunds an overpayment on a virtual account back to the sender via outbound transfer; merchantTxRef is derived from the original transactionId so a retried webhook can't double-refund. */
  async refundOverpayment(
    payment: WebhookTransactionData,
    expectedAmountNaira: number,
    opts?: { narration?: string }
  ): Promise<TransferResult> {
    const excess = payment.transaction.transactionAmount - expectedAmountNaira;
    if (excess <= 0) {
      throw new Error("refundOverpayment() called but transactionAmount does not exceed expectedAmountNaira");
    }
    if (!payment.customer?.accountNumber || !payment.customer.senderName || !payment.customer.bankCode) {
      throw new Error("refundOverpayment() called with a payload missing the sender's bank details");
    }
    return this.transferToBankAccount({
      amountNaira: excess,
      accountNumber: payment.customer.accountNumber,
      accountName: payment.customer.senderName,
      bankCode: payment.customer.bankCode,
      merchantTxRef: `refund_${payment.transaction.transactionId}`,
      senderName: this.config.businessName ?? "Refund",
      narration: opts?.narration ?? `Refund of overpayment on ${payment.transaction.aliasAccountNumber}`,
    });
  }

  // ---------------------------------------------------------------
  // Virtual accounts
  // ---------------------------------------------------------------

  /** POST /v1/accounts/virtual/{subAccountId} — issues a dedicated NUBAN after validating accountRef/accountName length; funds land in the configured sub-account, not the parent. */
  async createVirtualAccount(params: CreateVirtualAccountParams): Promise<VirtualAccount> {
    if (params.accountRef.length < 16 || params.accountRef.length > 64) {
      throw new RangeError("accountRef must be 16-64 characters");
    }
    if (params.accountName.length < 8 || params.accountName.length > 64) {
      throw new RangeError("accountName must be 8-64 characters");
    }
    // Deliberately NOT sending Nomba's "expectedAmount" wire field — confirmed in production it
    // makes Nomba reject/fail the incoming transfer whenever the sender pays a different amount
    // (over or under), even though our own bank rails don't enforce it either way (see
    // evaluatePayment()'s doc comment). params.expectedAmountNaira is kept as an input purely so
    // callers can still store their own expectation locally; it's intentionally dropped here
    // rather than forwarded.
    const { expectedAmountNaira: _expectedAmountNaira, ...rest } = params;
    return this.post(`/v1/accounts/virtual/${encodeURIComponent(this.config.subAccountId)}`, rest);
  }

  /** DELETE /v1/accounts/virtual/{accountRef} — releases a virtual account (past expiry, funded or abandoned); frees the contributor's 2-account cap slot on Nomba's side. accountRef is the same value passed to createVirtualAccount(), not Nomba's bankAccountNumber. */
  async expireVirtualAccount(accountRef: string): Promise<{ expired: boolean }> {
    return this.del(`/v1/accounts/virtual/${encodeURIComponent(accountRef)}`);
  }

  // ---------------------------------------------------------------
  // Transactions / reconciliation
  // ---------------------------------------------------------------

  /** GET /v1/transactions/accounts — fetches one page of transactions in a date range (optionally filtered by status), for use in reconciliation. */
  async fetchTransactions(params: {
    dateFrom: string;
    dateTo: string;
    status?: string;
    cursor?: string;
  }): Promise<{ results: Transaction[]; cursor?: string }> {
    const query = new URLSearchParams({ dateFrom: params.dateFrom, dateTo: params.dateTo });
    if (params.status) query.set("status", params.status);
    if (params.cursor) query.set("cursor", params.cursor);
    return this.get(`/v1/transactions/accounts?${query.toString()}`);
  }


  /**
   * Nightly reconciliation: pulls every Nomba transaction in the window and diffs it against the
   * local ledger, matched by merchantTxRef (never Nomba's internal id, which can rotate on
   * retries). Returns a structured report with per-transaction line items and a per-customer
   * rollup: "orphan" (Nomba has it, we don't), "overpaid"/"underpaid" (both have it, amounts
   * differ), "matched", or "missing_on_nomba" (expected but never landed, only if
   * `listExpectedRefs` is given).
   */
  async reconcile(params: {
    dateFrom: string;
    dateTo: string;
    status?: string;
    /** look up our local ledger record by merchantTxRef; return null if not found */
    findLocalByRef: (merchantTxRef: string) => Promise<LocalPaymentRecord | null>;
    /** optional: refs our ledger expected in this window, to catch payments that never arrived */
    listExpectedRefs?: () => Promise<string[]>;
    /** optional: called for every line item as it's found, e.g. to alert in real time */
    onLineItem?: (item: ReconciliationLineItem) => void | Promise<void>;
  }): Promise<ReconciliationReport> {
    const lineItems: ReconciliationLineItem[] = [];
    const seenRefs = new Set<string>();

    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const page = await this.fetchTransactions({
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        status: params.status,
        cursor,
      });

      for (const tx of page.results) {
        if (!tx.merchantTxRef) continue;
        seenRefs.add(tx.merchantTxRef);

        const local = await params.findLocalByRef(tx.merchantTxRef);
        const item = this.buildLineItem(tx.merchantTxRef, tx, local);
        lineItems.push(item);
        await params.onLineItem?.(item);
      }

      cursor = page.cursor;
      pageCount++;
      if (pageCount > MAX_RECONCILE_PAGES) {
        throw new Error(
          `reconcile() aborted after ${MAX_RECONCILE_PAGES} pages - Nomba may be returning a cursor that never terminates`
        );
      }
    } while (cursor);

    if (params.listExpectedRefs) {
      const expectedRefs = await params.listExpectedRefs();
      for (const ref of expectedRefs) {
        if (seenRefs.has(ref)) continue;
        const local = await params.findLocalByRef(ref);
        const item: ReconciliationLineItem = {
          status: "missing_on_nomba",
          merchantTxRef: ref,
          customerId: local?.customerId,
          localAmount: local?.amount,
        };
        lineItems.push(item);
        await params.onLineItem?.(item);
      }
    }

    return this.buildReport(params.dateFrom, params.dateTo, lineItems);
  }

  /** Classifies a single Nomba transaction against its (possibly missing) local record as one of: orphan, matched, overpaid, or underpaid. */
  private buildLineItem(ref: string, tx: Transaction, local: LocalPaymentRecord | null): ReconciliationLineItem {
    if (!local) {
      return { status: "orphan", merchantTxRef: ref, nombaAmount: tx.amount, nombaTransaction: tx };
    }
    // difference = what Nomba actually received minus what we expected locally.
    // positive = overpaid (received more than expected), negative = underpaid (received less).
    const difference = tx.amount - local.amount;
    const status: ReconciliationStatus = difference === 0 ? "matched" : difference > 0 ? "overpaid" : "underpaid";
    return {
      status,
      merchantTxRef: ref,
      customerId: local.customerId,
      nombaAmount: tx.amount,
      localAmount: local.amount,
      difference,
      nombaTransaction: tx,
    };
  }

  /** Turns the flat list of per-transaction line items from reconcile() into per-customer totals and status counts, so callers don't each re-filter/re-sum the same list themselves. */
  private buildReport(dateFrom: string, dateTo: string, lineItems: ReconciliationLineItem[]): ReconciliationReport {
    const byCustomerMap = new Map<string, CustomerReconciliationSummary>();

    for (const item of lineItems) {
      const key = item.customerId ?? "unknown";
      let summary = byCustomerMap.get(key);
      if (!summary) {
        summary = {
          customerId: key,
          expectedTotal: 0,
          receivedTotal: 0,
          overpaidTotal: 0,
          underpaidTotal: 0,
          lineItems: [],
        };
        byCustomerMap.set(key, summary);
      }
      summary.lineItems.push(item);
      if (item.localAmount != null) summary.expectedTotal += item.localAmount;
      if (item.nombaAmount != null) summary.receivedTotal += item.nombaAmount;
      if (item.status === "overpaid" && item.difference != null) summary.overpaidTotal += item.difference;
      if (item.status === "underpaid" && item.difference != null) summary.underpaidTotal += -item.difference;
    }

    const count = (status: ReconciliationStatus) => lineItems.filter((i) => i.status === status).length;

    return {
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
      totalChecked: lineItems.length,
      matchedCount: count("matched"),
      overpaidCount: count("overpaid"),
      underpaidCount: count("underpaid"),
      orphanCount: count("orphan"),
      missingOnNombaCount: count("missing_on_nomba"),
      lineItems,
      byCustomer: [...byCustomerMap.values()],
    };
  }

  // ---------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------

  /**
   * Verifies the "nomba-signature" header, checks for duplicate delivery (event.requestId
   * already seen is silently skipped), then calls `handler` with the parsed event.
   * SIGNATURE ALGORITHM is NOT a hash of the raw body: nine fields from the parsed payload
   * (event_type, requestId, merchant.userId/walletId, transaction.transactionId/type/time,
   * responseCode — "" if absent/"null" — and the nomba-timestamp header) are joined with ":",
   * HMAC-SHA256'd with the webhook secret, and Base64-encoded (not hex).
   * `rawBody` must be the exact raw request body (pre-JSON.parse).
   */
  async handleWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
    nombaTimestamp: string | undefined,
    handler: (event: WebhookEvent) => Promise<void> | void
  ): Promise<void> {
    if (!this.config.webhookSecret) {
      throw new Error("webhookSecret not configured");
    }
    if (!signature) {
      throw new Error("Missing nomba-signature header");
    }
    if (!nombaTimestamp) {
      throw new Error("Missing nomba-timestamp header");
    }

    let event: WebhookEvent<WebhookTransactionData>;
    try {
      event = JSON.parse(rawBody.toString()) as WebhookEvent<WebhookTransactionData>;
    } catch (err) {
      throw new Error(`Webhook payload is not valid JSON: ${(err as Error).message}`);
    }

    const expected = computeWebhookSignature(event, nombaTimestamp, this.config.webhookSecret);
    if (!safeEqualCaseInsensitive(signature, expected)) {
      throw new Error("bad signature");
    }

    if (!event.requestId) {
      throw new Error("Webhook payload missing requestId - cannot dedupe safely");
    }
    // Webhooks may fire twice (network retries) - don't apply the same event twice.
    if (await this.webhookIdStore.has(event.requestId)) return;

    await handler(event);

    await this.webhookIdStore.add(event.requestId);
  }

  /**
   * Compares the amount received against what was expected. Nomba's bank
   * rails accept any amount even when expectedAmount is set on the virtual
   * account, so always run this check before crediting/closing an invoice.
   */
  static evaluatePayment(
    amountReceived: number,
    expectedAmount?: number
  ): "exact" | "overpaid" | "underpaid" | "unknown_expectation" {
    if (expectedAmount == null) return "unknown_expectation";
    if (amountReceived === expectedAmount) return "exact";
    return amountReceived > expectedAmount ? "overpaid" : "underpaid";
  }

  // ---------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------

  /** Thin GET wrapper around request(). */
  private async get(path: string) {
    return this.request("GET", path);
  }

  /** Thin POST wrapper around request(). */
  private async post(path: string, body: unknown) {
    return this.request("POST", path, body);
  }

  /** Thin DELETE wrapper around request(). */
  private async del(path: string) {
    return this.request("DELETE", path);
  }

  /** Sends an authenticated HTTP request to the Nomba API and returns the unwrapped `data` payload, normalizing any failure (non-2xx response or network error) into a NombaApiError. */
  private async request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
    try {
      // /v1/auth/* endpoints don't need a bearer token; everything else does.
      const needsAuth = !path.startsWith("/v1/auth/");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        accountId: this.config.accountId,
      };
      if (needsAuth) {
        headers.Authorization = `Bearer ${await this.getAccessToken()}`;
      }

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      const json = await res.json().catch(() => ({}));

      // 201 on the transfer endpoint means "processing", not an error.
      if (!res.ok && res.status !== 201) {
        throw new NombaApiError(
          json?.description || json?.message || `Request failed (${res.status})`,
          res.status,
          json?.code,
          json
        );
      }

      return json.data ?? json;
    } catch (err) {
      // Already normalized - e.g. a non-2xx response above, or a nested
      // getAccessToken() -> request() call for the token endpoints. Don't
      // double-wrap, just propagate as-is.
      if (err instanceof NombaApiError) throw err;
      // Anything else - network failure, DNS error, timeout, a request body
      // that failed to serialize, etc - normalize so callers only ever need
      // to handle one error type from this client, no matter where in this
      // method it originated.
      throw new NombaApiError(`Nomba API request failed: ${(err as Error).message}`, 0, undefined, err);
    }
  }
}

/** Rebuilds the exact colon-delimited string Nomba signs and HMAC-SHA256 + Base64-encodes it with the webhook secret — see handleWebhook's doc comment for the field order. */
function computeWebhookSignature(
  event: WebhookEvent<WebhookTransactionData>,
  nombaTimestamp: string,
  webhookSecret: string
): string {
  const merchant = event.data?.merchant;
  const transaction = event.data?.transaction;

  const responseCode =
    !transaction?.responseCode || transaction.responseCode === "null" ? "" : transaction.responseCode;

  const hashingPayload = [
    event.event_type ?? "",
    event.requestId ?? "",
    merchant?.userId ?? "",
    merchant?.walletId ?? "",
    transaction?.transactionId ?? "",
    transaction?.type ?? "",
    transaction?.time ?? "",
    responseCode,
    nombaTimestamp,
  ].join(":");

  return createHmac("sha256", webhookSecret).update(hashingPayload).digest("base64");
}

/** Compares two strings for equality in constant time and case-insensitively, matching Nomba's own reference signature-comparison behavior. */
function safeEqualCaseInsensitive(a: string, b: string): boolean {
  const bufA = Buffer.from(a.toLowerCase());
  const bufB = Buffer.from(b.toLowerCase());
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
