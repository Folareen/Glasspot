import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { closeQueues } from "./helpers/queue";
import { createTestUser, createTestPot } from "./helpers/factories";
import { AccountsService } from "../src/modules/ledger/accounts.service";
import { LedgerService } from "../src/modules/ledger/ledger.service";
import { ReconciliationService } from "../src/modules/ledger/reconciliation.service";
import { outboundFeeLegs, OUTBOUND_FEE } from "../src/lib/fees";
import { nomba } from "../src/integrations/nomba";
import type { Transaction as NombaTransaction } from "../src/integrations/nomba/nomba.types";
import type { FastifyInstance } from "fastify";

/** Stubs nomba.fetchTransactions to return exactly one page of the given transactions, then an empty terminal page. */
function mockFetchTransactions(t: import("node:test").TestContext, transactions: NombaTransaction[]) {
  let called = false;
  return t.mock.method(nomba, "fetchTransactions", async () => {
    if (called) return { results: [] };
    called = true;
    return { results: transactions };
  });
}

describe("ReconciliationService.runForWindow", () => {
  let app: FastifyInstance;

  before(async () => {
    app = createTestApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDb();
    await closeQueues();
  });

  beforeEach(async () => {
    await resetDb();
  });

  test("an outbound payout transaction matches Nomba's reported amount exactly — no false amount_mismatch", async (t) => {
    // Regression: transactions.amount used to be the pot's GROSS debit (recipientAmount +
    // OUTBOUND_FEE), so comparing it against Nomba's reported net transfer amount always flagged
    // amount_mismatch (-OUTBOUND_FEE) even for a perfectly successful payout. amount is now the
    // actual cash moved (recipientAmount), which is exactly what Nomba's own reported amount is.
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const platformRevenue = await AccountsService.getOrCreateSystemAccount("platform_revenue");
    const nombaFeeExpense = await AccountsService.getOrCreateSystemAccount("nomba_fee_expense");
    const nombaClearing = await AccountsService.getOrCreateSystemAccount("nomba_clearing");

    // Fund the pot so the payout's debit doesn't go negative.
    await LedgerService.postTransaction({
      type: "funding",
      reference: `test_seed_${randomUUID()}`,
      amount: 100_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amount: 100_000n },
        { accountId: potAccount.id, direction: "credit", amount: 100_000n },
      ],
    });

    const recipientAmount = 50_000n; // what the recipient actually receives
    const reference = `payout_${pot.id}_${randomUUID()}`;
    await LedgerService.postTransaction({
      type: "payout",
      reference,
      status: "processing",
      amount: recipientAmount,
      entries: outboundFeeLegs(
        {
          potAccountId: potAccount.id,
          platformFloatId: platformFloat.id,
          platformRevenueId: platformRevenue.id,
          nombaFeeExpenseId: nombaFeeExpense.id,
          nombaClearingId: nombaClearing.id,
        },
        recipientAmount
      ),
      metadata: { potId: pot.id },
    });

    mockFetchTransactions(t, [
      {
        id: "nomba_tx_1",
        status: "success",
        amount: 500.0, // Nomba's reported NET transfer amount, in naira — 50_000n kobo
        merchantTxRef: reference,
      },
    ]);

    const dateFrom = new Date(Date.now() - 60 * 60 * 1000);
    const dateTo = new Date(Date.now() + 60 * 1000);
    const batch = await ReconciliationService.runForWindow(dateFrom, dateTo);

    assert.equal(batch.status, "matched", "a correctly-recognized payout must reconcile as matched, not amount_mismatch");
    assert.equal(batch.expectedAmount, recipientAmount);
    assert.equal(batch.reportedAmount, recipientAmount);
  });

  test("a genuine amount discrepancy still surfaces as mismatched", async (t) => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const platformRevenue = await AccountsService.getOrCreateSystemAccount("platform_revenue");
    const nombaFeeExpense = await AccountsService.getOrCreateSystemAccount("nomba_fee_expense");
    const nombaClearing = await AccountsService.getOrCreateSystemAccount("nomba_clearing");

    await LedgerService.postTransaction({
      type: "funding",
      reference: `test_seed_${randomUUID()}`,
      amount: 100_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amount: 100_000n },
        { accountId: potAccount.id, direction: "credit", amount: 100_000n },
      ],
    });

    const recipientAmount = 50_000n;
    const reference = `payout_${pot.id}_${randomUUID()}`;
    await LedgerService.postTransaction({
      type: "payout",
      reference,
      status: "processing",
      amount: recipientAmount,
      entries: outboundFeeLegs(
        {
          potAccountId: potAccount.id,
          platformFloatId: platformFloat.id,
          platformRevenueId: platformRevenue.id,
          nombaFeeExpenseId: nombaFeeExpense.id,
          nombaClearingId: nombaClearing.id,
        },
        recipientAmount
      ),
      metadata: { potId: pot.id },
    });

    // Nomba reports a genuinely different amount than what we posted locally — a real
    // discrepancy this pass must still catch, not silently pass over.
    mockFetchTransactions(t, [
      {
        id: "nomba_tx_2",
        status: "success",
        amount: 450.0, // 45_000n kobo — really does differ from our local 50_000n
        merchantTxRef: reference,
      },
    ]);

    const dateFrom = new Date(Date.now() - 60 * 60 * 1000);
    const dateTo = new Date(Date.now() + 60 * 1000);
    const batch = await ReconciliationService.runForWindow(dateFrom, dateTo);

    assert.equal(batch.status, "mismatched");
  });

  test("a payout Nomba has no record of at all is reported missing_on_nomba, not falsely matched", async (t) => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const platformRevenue = await AccountsService.getOrCreateSystemAccount("platform_revenue");
    const nombaFeeExpense = await AccountsService.getOrCreateSystemAccount("nomba_fee_expense");
    const nombaClearing = await AccountsService.getOrCreateSystemAccount("nomba_clearing");

    await LedgerService.postTransaction({
      type: "funding",
      reference: `test_seed_${randomUUID()}`,
      amount: 100_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amount: 100_000n },
        { accountId: potAccount.id, direction: "credit", amount: 100_000n },
      ],
    });

    const recipientAmount = 50_000n;
    const reference = `payout_${pot.id}_${randomUUID()}`;
    await LedgerService.postTransaction({
      type: "payout",
      reference,
      status: "processing",
      amount: recipientAmount,
      entries: outboundFeeLegs(
        {
          potAccountId: potAccount.id,
          platformFloatId: platformFloat.id,
          platformRevenueId: platformRevenue.id,
          nombaFeeExpenseId: nombaFeeExpense.id,
          nombaClearingId: nombaClearing.id,
        },
        recipientAmount
      ),
      metadata: { potId: pot.id },
    });

    // Nomba's transaction list comes back completely empty for this window.
    mockFetchTransactions(t, []);

    const dateFrom = new Date(Date.now() - 60 * 60 * 1000);
    const dateTo = new Date(Date.now() + 60 * 1000);
    const batch = await ReconciliationService.runForWindow(dateFrom, dateTo);

    assert.equal(batch.status, "mismatched");
  });
});
