/**
 * Nomba API client (simplified)
 * ----------------------------------------------------------------
 * Covers:
 *   - POST /v1/auth/token/issue      obtain access token
 *   - POST /v1/auth/token/refresh    refresh an expired token
 *   - GET  /v1/transfers/banks       fetch bank codes and names
 *   - POST /v1/transfers/bank/lookup bank account lookup
 *   - POST /v2/transfers/bank        bank transfer from parent account
 *   - POST /v1/accounts/virtual      create virtual account
 *   - GET  /v1/transactions/accounts list transactions (for reconciliation)
 *   - webhook signature verification + a nightly reconciliation helper
 *
 * Requires Node 18+ (global fetch). Token is cached in memory and refreshed
 * at the 55-minute mark 
 * 
 * * REFUNDS: Nomba does not expose a dedicated "refund" endpoint for virtual
 * account overpayments. The correct mechanism - confirmed via Nomba's docs -
 * is to send the excess back to the sender as a normal outbound transfer
 * using the bank details included in the payment webhook. refundOverpayment()
 * below wraps that.
 *
 * WEBHOOK PAYLOAD: confirmed against Nomba's docs. A virtual account funding
 * event arrives as event_type "virtual_account.funded" with this shape:
 *   {
 *     event_type: "virtual_account.funded",
 *     requestId: "...",
 *     data: {
 *       merchant: { walletId, walletBalance, userId },
 *       transaction: { aliasAccountNumber, aliasAccountName, aliasAccountType,
 *                       transactionId, transactionAmount, fee, narration, time, type },
 *       customer: { senderName, accountNumber, bankCode, bankName }
 *     }
 *   }
 * Nomba does not echo back the expectedAmount you set when creating the
 * account, so compare transaction.transactionAmount against your own stored
 * expectation (e.g. looked up by aliasAccountNumber or narration).
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
    VirtualAccountPaymentData,
    ReconciliationStatus,
    LocalPaymentRecord,
    ReconciliationLineItem,
    CustomerReconciliationSummary,
    ReconciliationReport
}
from "./nomba.types.js";

import { NombaApiError } from "./nomba.error.js"
import { InMemoryWebhookIdStore, WebhookIdStore } from "./webhooks.js";


const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** safety valve against an infinite reconcile() loop if Nomba ever returns a cursor that never terminates */
const MAX_RECONCILE_PAGES = 10_000;


export class NombaClient {
  private baseUrl: string;
  private cachedToken: { accessToken: string; refreshToken: string; refreshAt: number } | null = null;
  private banks = new Map<string, Bank>(); // cache bank codes for lookupBankAccount()
  private webhookIdStore: WebhookIdStore;
  private requestTimeoutMs: number;
  /** shared in-flight token request so concurrent callers don't each hit the auth endpoint independently */
  private inFlightTokenRequest: Promise<{ accessToken: string; refreshToken: string; refreshAt: number }> | null =
    null;


  constructor(private config: NombaClientConfig) {
    this.baseUrl = BASE_URLS[config.environment ?? "production"];
    this.webhookIdStore = config.webhookIdStore ?? new InMemoryWebhookIdStore();
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

  /** GET /v1/transfers/banks - cache this; bank codes rarely change. */
  async fetchBankCodes(): Promise<Bank[]> {
    // stored in a Map for fast lookup by code in lookupBankAccount(); return as an array.
    if (this.banks.size > 0) {
      return Array.from(this.banks.values());
    }

    const data = await this.get("/v1/transfers/banks");
    data.results.forEach((bank: Bank) => this.banks.set(bank.code, bank));

    return data.results;
  }

  /** POST /v1/transfers/bank/lookup - always call before transferToBankAccount(). */
  async lookupBankAccount(accountNumber: string, bankCode: string): Promise<BankAccountLookupResult> {
    return this.post("/v1/transfers/bank/lookup", { accountNumber, bankCode });
  }

  /**
   * POST /v2/transfers/bank
   * Returns immediately. `status` may be:
   *   - "SUCCESS"         settled
   *   - "PENDING_BILLING" accepted but not yet settled - rely on the
   *                        transfer.success / transfer.failed webhook for the
   *                        final outcome; do not retry with a new reference
   *   - a failure code (see TransferStatus) - on failure Nomba auto-refunds
   *     your account and status becomes "REFUND"; you may safely retry with
   *     a brand-new merchantTxRef in that case
   */
  async transferToBankAccount(params: TransferParams): Promise<TransferResult> {
    return this.post("/v2/transfers/bank", params);
  }

  
  /**
   * Refund an overpayment on a virtual account back to the sender.
   *
   * Nomba has no dedicated refund endpoint for this - the correct mechanism
   * is a normal outbound transfer to the account that overpaid, using the
   * sender's bank details from the payment webhook. `merchantTxRef` is
   * derived from the original transactionId so a retried webhook can't
   * trigger a duplicate refund.
   *
   * @param payment        `data` from the payment_success webhook (virtual account funding)
   * @param expectedAmount the amount you were expecting for this payment
   * @throws if the payment isn't actually an overpayment
   */
  async refundOverpayment(
    payment: VirtualAccountPaymentData,
    expectedAmount: number,
    opts?: { narration?: string }
  ): Promise<TransferResult> {
    const excess = payment.transaction.transactionAmount - expectedAmount;
    if (excess <= 0) {
      throw new Error("refundOverpayment() called but transactionAmount does not exceed expectedAmount");
    }
    return this.transferToBankAccount({
      amount: excess,
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

  /** POST /v1/accounts/virtual - issue a dedicated NUBAN for a customer or invoice. */
  async createVirtualAccount(params: CreateVirtualAccountParams): Promise<VirtualAccount> {
    if (params.accountRef.length < 16 || params.accountRef.length > 64) {
      throw new RangeError("accountRef must be 16-64 characters");
    }
    if (params.accountName.length < 8 || params.accountName.length > 64) {
      throw new RangeError("accountName must be 8-64 characters");
    }
    return this.post("/v1/accounts/virtual", params);
  }

  // ---------------------------------------------------------------
  // Transactions / reconciliation
  // ---------------------------------------------------------------

  /** GET /v1/transactions/accounts */
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
   * Nightly reconciliation: pulls every Nomba transaction in the window and
   * diffs it against local ledger, matched by merchantTxRef (never
   * Nomba's internal id, which can rotate on retries). Returns a structured
   * report with per-transaction line items and a per-customer rollup, so you
   * can both alert on individual drift and see which customers are affected.
   *
   *  - "orphan":          Nomba has the transaction, we don't
   *  - "overpaid" / "underpaid": both sides have it, amounts differ
   *  - "matched":          both sides agree
   *  - "missing_on_nomba": our ledger expected a payment that never landed
   *                         on Nomba (only reported if `listExpectedRefs` is given)
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
 
  /**
   * Turns the flat list of per-transaction line items from reconcile() into
   * per-customer totals and status counts.
   *
   * Example: given
   *   lineItems = [
   *     { customerId: "alice", status: "matched",  localAmount: 5000, nombaAmount: 5000, difference: 0 },
   *     { customerId: "bob",   status: "overpaid", localAmount: 5000, nombaAmount: 6000, difference: 1000 },
   *     { customerId: "bob",   status: "underpaid",localAmount: 5000, nombaAmount: 3000, difference: -2000 },
   *     { customerId: undefined, status: "orphan", nombaAmount: 1000 },
   *   ]
   * this produces:
   *   - matchedCount: 1, overpaidCount: 1, underpaidCount: 1, orphanCount: 1
   *   - byCustomer:
   *       alice:   expectedTotal 5000, receivedTotal 5000
   *       bob:     expectedTotal 10000, receivedTotal 9000, overpaidTotal 1000, underpaidTotal 2000
   *       unknown: receivedTotal 1000 (the orphan, which has no customerId to attach to)
   *
   * Without this step, every caller of reconcile() would have to re-filter
   * and re-sum the same flat list themselves just to answer "does Bob owe us
   * money?" - doing it once here guarantees a consistent answer everywhere.
   */
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
   * Verifies the "nomba-signature" header (HMAC-SHA256 hex digest of the raw
   * body), checks for duplicate delivery, then calls `handler` with the
   * parsed event - so routes stay a few lines, e.g.:
   *
   *   app.post("/webhooks/nomba", express.raw({ type: "application/json" }), (req, res) => {
   *     nomba
   *       .handleWebhook(req.body, req.header("nomba-signature"), async (event) => {
   *         // business logic here
   *       })
   *       .then(() => res.sendStatus(200))
   *       .catch((err) => res.status(401).send(err.message));
   *   });
   *
   * `rawBody` must be the exact raw request body (a Buffer or string from a
   * raw-body parser, before JSON.parse) - re-serialized JSON won't match the
   * bytes Nomba signed. Duplicate deliveries (event.requestId already seen)
   * are silently skipped without calling `handler` again.
   */
  async handleWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
    handler: (event: WebhookEvent) => Promise<void> | void
  ): Promise<void> {
    if (!this.config.webhookSecret) {
      throw new Error("webhookSecret not configured");
    }
 
    const expected = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    if (!signature || !safeEqual(signature, expected)) {
      throw new Error("bad signature");
    }
 
    let event: WebhookEvent;
    try {
      event = JSON.parse(rawBody.toString()) as WebhookEvent;
    } catch (err) {
      throw new Error(`Webhook payload is not valid JSON: ${(err as Error).message}`);
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

  private async get(path: string) {
    return this.request("GET", path);
  }

  private async post(path: string, body: unknown) {
    return this.request("POST", path, body);
  }
 
  private async request(method: "GET" | "POST", path: string, body?: unknown) {
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

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// -----------------------------------------------------------------
// Usage
// -----------------------------------------------------------------
//
// import { nomba } from "./nomba"; // singleton, see nomba.ts
//
// // --- Transact: create a virtual account for an invoice ---
// const account = await nomba.createVirtualAccount({
//   accountRef: `invoice_${invoiceId}`,
//   accountName: customer.fullName,
//   expectedAmount: invoice.total,
// });
//
// // --- Transact: pay out to a bank account (always lookup first) ---
// const resolved = await nomba.lookupBankAccount("0554772814", "058");
// // show resolved.accountName to the user for confirmation, then:
// await nomba.transferToBankAccount({
//   amount: 3500,
//   accountNumber: "0554772814",
//   accountName: resolved.accountName,
//   bankCode: "058",
//   merchantTxRef: `payout_${payoutId}`,
//   senderName: "Acme Inc",
// });
//
// // --- Webhooks + refund on overpayment ---
// app.post("/webhooks/nomba", express.raw({ type: "application/json" }), (req, res) => {
//   nomba
//     .handleWebhook(req.body, req.header("nomba-signature"), async (event) => {
//       if (event.event_type !== "payment_success") return;
//       const payment = event.data as VirtualAccountPaymentData;
//       if (payment.transaction.aliasAccountType !== "VIRTUAL") return;
//
//       const invoice = await db.invoices.findOne({ virtualAccountNumber: payment.transaction.aliasAccountNumber });
//       const verdict = NombaClient.evaluatePayment(payment.transaction.transactionAmount, invoice?.total);
//
//       if (verdict === "overpaid") {
//         await nomba.refundOverpayment(payment, invoice!.total);
//       } else if (verdict === "underpaid") {
//         await notifyCustomer(invoice, "short payment received");
//       } else if (verdict === "exact") {
//         await db.invoices.markPaid(invoice!.id);
//       }
//     })
//     .then(() => res.sendStatus(200))
//     .catch((err) => res.status(401).send(err.message));
// });
//
// // --- Nightly reconciliation with a customer-level report ---
// const report = await nomba.reconcile({
//   dateFrom: "2026-03-01",
//   dateTo: "2026-03-31",
//   status: "success",
//   findLocalByRef: (ref) => db.payments.findOne({ ref }),
//   listExpectedRefs: () => db.payments.listExpectedRefsForWindow("2026-03-01", "2026-03-31"),
//   onLineItem: (item) => {
//     if (item.status !== "matched") alertOps(item.status, item);
//   },
// });
// console.log(`${report.overpaidCount} overpaid, ${report.underpaidCount} underpaid, ${report.orphanCount} orphans`);
// for (const customer of report.byCustomer) {
//   console.log(customer.customerId, customer.receivedTotal, "received vs", customer.expectedTotal, "expected");
// }