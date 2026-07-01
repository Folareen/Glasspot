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
 * at the 55-minute mark - swap `cachedToken` for Redis if you run multiple
 * instances (see comment near the bottom).
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
    BASE_URLS
}
from "./nomba.types.js";

import { NombaApiError } from "./nomba.error.js"
import { InMemoryWebhookIdStore, WebhookIdStore } from "./webhooks.js";

export class NombaClient {
  private baseUrl: string;
  private cachedToken: { accessToken: string; refreshToken: string; refreshAt: number } | null = null;
  private banks = new Set<Bank>(); // cache bank codes for lookupBankAccount()
  private webhookIdStore: WebhookIdStore;


  constructor(private config: NombaClientConfig) {
    this.baseUrl = BASE_URLS[config.environment ?? "production"];
    this.webhookIdStore = config.webhookIdStore ?? new InMemoryWebhookIdStore();
  }

  // ---------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------

  /** Returns a cached token, refreshing at the 55-minute mark instead of on every call. */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.refreshAt) {
      return this.cachedToken.accessToken;
    }

    const data = this.cachedToken
      ? await this.post("/v1/auth/token/refresh", {
          grant_type: "refresh_token",
          refresh_token: this.cachedToken.refreshToken,
        })
      : await this.post("/v1/auth/token/issue", {
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        });

    // Tokens are valid 60 minutes; refresh 5 minutes early.
    this.cachedToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      refreshAt: Date.parse(data.expiresAt) - 5 * 60 * 1000,
    };
    return this.cachedToken.accessToken;
  }

  // ---------------------------------------------------------------
  // Banks / lookup / transfer
  // ---------------------------------------------------------------

  /** GET /v1/transfers/banks - cache this; bank codes rarely change. */
  async fetchBankCodes(): Promise<Bank[]> {
    if (this.banks.size > 0) {
      return Array.from(this.banks.values());
    }

    const data = await this.get("/v1/transfers/banks");
    data.results.forEach((bank: Bank) => this.banks.add(bank));

    return data.results;
  }

  /** POST /v1/transfers/bank/lookup - always call before transferToBankAccount(). */
  async lookupBankAccount(accountNumber: string, bankCode: string): Promise<BankAccountLookupResult> {
    return this.post("/v1/transfers/bank/lookup", { accountNumber, bankCode });
  }

  /**
   * POST /v2/transfers/bank
   * Returns immediately. If the transfer isn't settled yet, `status` is
   * "PENDING_BILLING" - rely on the transfer.success / transfer.failed
   * webhook for the final outcome. merchantTxRef is your idempotency key;
   * don't retry with a new one.
   */
  async transferToBankAccount(params: TransferParams): Promise<TransferResult> {
    const data = await this.post("/v2/transfers/bank", params);
    return data;
  }

  // ---------------------------------------------------------------
  // Virtual accounts
  // ---------------------------------------------------------------

  /** POST /v1/accounts/virtual - issue a dedicated NUBAN for a customer or invoice. */
  async createVirtualAccount(params: CreateVirtualAccountParams): Promise<VirtualAccount> {
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
   * Nightly reconciliation: pulls transactions in the window and diffs them
   * against our local ledger, matched by merchantTxRef (never Nomba's
   * internal id, which can rotate on retries). Logs/alerts on drift.
   */
  async reconcile(params: {
    dateFrom: string;
    dateTo: string;
    status?: string;
    findLocalByRef: (ref: string) => Promise<{ amount: number } | null>;
    onDrift: (message: string, details: Record<string, unknown>) => void;
  }): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.fetchTransactions({ ...params, cursor });
      for (const tx of page.results) {
        if (!tx.merchantTxRef) continue;
        const local = await params.findLocalByRef(tx.merchantTxRef); // our local function that fetches transactions by ref
        if (!local) {
          params.onDrift("Orphan transaction on Nomba", { tx }); // a logger or alerting function
        } else if (local.amount !== tx.amount) {
          params.onDrift("Amount drift", { local, tx }); // a logger or alerting function
        }
      }
      cursor = page.cursor;
    } while (cursor);
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
 
    const event = JSON.parse(rawBody.toString()) as WebhookEvent;
 
    // Webhooks may fire twice (network retries) - don't apply the same event twice.
    if (await this.webhookIdStore.has(event.requestId)) return;
 
    await handler(event);

    await this.webhookIdStore.add(event.requestId);
  }


  /** Compares amountReceived to amountExpected for a virtual_account.funded event. */
  static evaluatePayment(data: { amountReceived: number; amountExpected?: number }) {
    if (data.amountExpected == null) return "unknown_expectation" as const;
    if (data.amountReceived === data.amountExpected) return "exact" as const;
    return data.amountReceived > data.amountExpected ? ("overpaid" as const) : ("underpaid" as const);
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
      throw new NombaApiError(json?.description || json?.message || `Request failed (${res.status})`, res.status, json);
    }

    return json.data ?? json;
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
// const nomba = new NombaClient({
//   clientId: process.env.NOMBA_CLIENT_ID!,
//   clientSecret: process.env.NOMBA_CLIENT_SECRET!,
//   accountId: process.env.NOMBA_ACCOUNT_ID!,
//   webhookSecret: process.env.NOMBA_WEBHOOK_SECRET!,
// });
//
// const account = await nomba.createVirtualAccount({
//   accountRef: `invoice_${invoiceId}`,
//   accountName: customer.fullName,
//   expectedAmount: invoice.total,
// });
//
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
// // webhook handler
// app.post("/webhooks/nomba", express.raw({ type: "application/json" }), (req, res) => {
//   nomba
//     .handleWebhook(req.body, req.header("nomba-signature"), async (event) => {
//       if (event.event_type === "virtual_account.funded") {
//         const verdict = NombaClient.evaluatePayment(event.data);
//         if (verdict === "overpaid") { /* refund the difference */ }
//         if (verdict === "underpaid") { /* notify the customer */ }
//       }
//     })
//     .then(() => res.sendStatus(200))
//     .catch((err) => res.status(401).send(err.message));
// });
//
// // Nightly cron
// await nomba.reconcile({
//   dateFrom: "2026-03-01",
//   dateTo: "2026-03-31",
//   status: "success",
//   findLocalByRef: (ref) => db.payments.findOne({ ref }),
//   onDrift: (msg, details) => alertOps(msg, details),
// });