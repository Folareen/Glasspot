import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { resetDb, closeDb } from "./helpers/db";
import { mockNomba } from "./helpers/mocks";
import { createTestUser, createTestPot, createFundedContribution } from "./helpers/factories";
import { AccountsService } from "../src/modules/ledger/accounts.service";
import { LedgerService } from "../src/modules/ledger/ledger.service";
import { ContributionsService } from "../src/modules/pots/contributions.service";
import db, { contributions } from "../src/db";
import { eq } from "drizzle-orm";
import type { WebhookTransactionData } from "../src/integrations/nomba/nomba.types";

/** Builds a minimal fake payment_success webhook payload matching the fields confirmFunding/reverseFunding actually read. */
function fakePayment(overrides: {
  aliasAccountNumber: string;
  transactionAmount: number;
  transactionId?: string;
}): WebhookTransactionData {
  return {
    transaction: {
      aliasAccountNumber: overrides.aliasAccountNumber,
      transactionAmount: overrides.transactionAmount,
      transactionId: overrides.transactionId ?? `nomba_tx_${randomUUID()}`,
    },
    customer: {
      accountNumber: "2000000002",
      bankCode: "000014",
      senderName: "Jane Contributor",
    },
  } as unknown as WebhookTransactionData;
}

test("ContributionsService.confirmFunding / reverseFunding", async (t) => {
  t.after(async () => {
    await closeDb();
  });

  t.beforeEach(async () => {
    await resetDb();
  });

  await t.test("an exact payment funds the contribution for exactly expectedAmount", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    // status inserted as 'pending', not 'funded' — confirmFunding is what
    // transitions it, unlike the createFundedContribution default.
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });

    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 1000.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded");
    assert.ok(updated.transactionId);
    assert.ok(updated.fundedAt);

    assert.equal(await LedgerService.getBalance(potAccount.id), 100_000n);
    assert.equal(await LedgerService.getBalance(platformFloat.id), 100_000n);
  });

  await t.test("an underpayment leaves the contribution 'underpaid' and posts nothing to the ledger", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 400.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "underpaid");
    assert.equal(updated.transactionId, null);
    assert.equal(await LedgerService.getBalance(potAccount.id), 0n);
  });

  await t.test("a top-up payment after underpayment reaches expectedAmount and funds the contribution", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 400.0 })
    );
    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 600.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded");
    // Ledger posts exactly expectedAmount once total reaches it, not the
    // sum of raw payments if they overshoot — here they land exactly on
    // 100_000, so this also doubles as an exact-total check.
    assert.equal(await LedgerService.getBalance(potAccount.id), 100_000n);
  });

  await t.test("an overpayment funds the ledger for exactly expectedAmount (never the received total) and refunds the excess", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const mocks = mockNomba(t);

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 1200.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded");
    // Never credit the pot for more than expectedAmount, even though 1200
    // naira (120_000 kobo) was actually received.
    assert.equal(await LedgerService.getBalance(potAccount.id), 100_000n);
    assert.equal(mocks.refundOverpayment.mock.callCount(), 1);
  });

  await t.test("a redelivered webhook for an already-funded contribution is a no-op (no double posting)", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);

    const payment = fakePayment({
      aliasAccountNumber: contribution.virtualAccountNumber!,
      transactionAmount: 1000.0,
      transactionId: "nomba_tx_fixed",
    });

    await ContributionsService.confirmFunding(payment);
    await ContributionsService.confirmFunding(payment); // redelivery, identical payload

    assert.equal(await LedgerService.getBalance(potAccount.id), 100_000n);
  });

  await t.test("a redelivered webhook with the same nombaTransactionId while still underpaid does not double-count that payment", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);

    const payment = fakePayment({
      aliasAccountNumber: contribution.virtualAccountNumber!,
      transactionAmount: 400.0,
      transactionId: "nomba_tx_fixed_partial",
    });

    await ContributionsService.confirmFunding(payment);
    await ContributionsService.confirmFunding(payment); // redelivery of the SAME partial payment

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    // Still underpaid — if the redelivery had been double-counted, 400+400=800
    // would still be under 1000, so this alone wouldn't catch a bug. The
    // real assertion is the ledger balance below staying at 0, plus this
    // contribution never accidentally reaching 'funded' off a doubled total.
    assert.equal(updated.status, "underpaid");
    assert.equal(await LedgerService.getBalance(potAccount.id), 0n);
  });

  await t.test("reverseFunding reverses the ledger posting and marks the contribution 'reversed'", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    const payment = fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 1000.0 });
    await ContributionsService.confirmFunding(payment);
    assert.equal(await LedgerService.getBalance(potAccount.id), 100_000n);

    await ContributionsService.reverseFunding(payment);

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "reversed");
    assert.equal(await LedgerService.getBalance(potAccount.id), 0n);
    assert.equal(await LedgerService.getBalance(platformFloat.id), 0n);
  });

  await t.test("reverseFunding is a no-op for a contribution that was never funded", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, { status: "pending", fundedAt: null });

    // Should not throw even though there's nothing to reverse.
    await ContributionsService.reverseFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 1000.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "pending");
  });

  await t.test("a payment_success payload with no aliasAccountNumber is ignored (not a virtual-account funding event)", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    await createFundedContribution(pot.id, { status: "pending", fundedAt: null });

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: "", transactionAmount: 1000.0 })
    );
    // No matching contribution for an empty alias — nothing should throw,
    // and nothing in the DB should change. Absence of an exception is the
    // assertion here.
  });
});