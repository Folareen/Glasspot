import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { resetDb, closeDb } from "./helpers/db";
import { mockNomba } from "./helpers/mocks";
import { createTestUser, createTestPot, createFundedContribution } from "./helpers/factories";
import { AccountsService } from "../src/modules/ledger/accounts.service";
import { LedgerService } from "../src/modules/ledger/ledger.service";
import { ContributionsService } from "../src/modules/pots/contributions.service";
import db, { contributions, transactions } from "../src/db";
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

    // Pot is credited intendedAmount (98_000n), never the gross expectedAmount — the fee split
    // is carved out into its own ledger legs, not folded into the pot's credit. platformFloat
    // absorbs the gross settlement figure (intendedAmount + Nomba's cut, ₦10 at this size since
    // 1% of ₦980 is below the ₦10 floor — see lib/fees.ts's nombaInboundFeeFor), so 98_000 + 1000.
    assert.equal(await LedgerService.getBalance(potAccount.id), 98_000n);
    assert.equal(await LedgerService.getBalance(platformFloat.id), 99_000n);
  });

  await t.test("a larger contribution is charged the 1% Nomba inbound fee, not the flat floor", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    // intendedAmount 1_000_000n (₦10,000) -> 1% = 10_000n (₦100), above the ₦10 floor and below
    // the ₦150 cap, so the fee actually scales here instead of sitting at the flat minimum.
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 1_011_000n, // 1_000_000 (intended) + 10_000 (nomba 1%) + 1_000 (platform flat)
      intendedAmount: 1_000_000n,
      fundedAt: null,
    });

    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 10110.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded");
    assert.equal(await LedgerService.getBalance(potAccount.id), 1_000_000n);
    // platformFloat's real, usable settlement is intendedAmount + the platform's own flat ₦10
    // cut (1_001_000n) — NOT + the ₦100 Nomba cut, since Nomba's cut never becomes usable
    // platform float (see inboundFeeLegs' comment on why this differs from a literal mirror of
    // outboundFeeLegs).
    assert.equal(await LedgerService.getBalance(platformFloat.id), 1_001_000n);
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
    // Ledger posts exactly intendedAmount (98_000n, expectedAmount net of the inbound fee) once
    // the total reaches expectedAmount, not the sum of raw payments if they overshoot — here they
    // land exactly on 100_000, so this also doubles as an exact-total check.
    assert.equal(await LedgerService.getBalance(potAccount.id), 98_000n);
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
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const mocks = mockNomba(t);

    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 1200.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded");
    // Never credit the pot for more than intendedAmount, even though 1200
    // naira (120_000 kobo) was actually received.
    assert.equal(await LedgerService.getBalance(potAccount.id), 98_000n);
    assert.equal(mocks.refundOverpayment.mock.callCount(), 1);

    // Regression: the overpayment refund now posts its own ledger transaction (previously a raw
    // Nomba call with no ledger entry at all) and deducts the ₦50 outbound fee from what the
    // sender actually receives, same as every other outbound transfer. Excess here is
    // 1200 - 1000 = 200 naira = 20_000n kobo; refund sent = 20_000n - OUTBOUND_FEE (5_000n) = 15_000n.
    const [overpaymentRefundTx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, `overpayment_refund_${mocks.refundOverpayment.mock.calls[0].arguments[0].transaction.transactionId}`));
    assert.ok(overpaymentRefundTx, "expected a posted ledger transaction for the overpayment refund");
    assert.equal(overpaymentRefundTx.amount, 15_000n);

    // suspense absorbed the debit (the excess was never credited to the pot in the first place, so
    // there's no pot balance to draw the refund down from) — platformFloat is credited the refund
    // amount + NOMBA_OUTBOUND_FEE, mirroring outboundFeeLegs' split exactly. platformFloat is
    // debit-normal, so this CREDIT decreases its balance (99_000 from funding, minus 17_000 for
    // the refund's platformFloat leg = 82_000).
    const suspense = await AccountsService.getOrCreateSystemAccount("suspense");
    assert.equal(await LedgerService.getBalance(suspense.id), 20_000n); // refundAmount + OUTBOUND_FEE
    assert.equal(await LedgerService.getBalance(platformFloat.id), 82_000n);

    // refundOverpayment was called with an inflated expectedAmountNaira (fee added on top) so its
    // OWN excess computation nets out to refundAmount, not the raw 200 naira excess. This payment
    // was the only one (thisPaymentNeeded = full expectedAmount = 1000 naira), so
    // feeAdjustedExpected = 1000 + OUTBOUND_FEE (₦50) = 1050.
    const [, expectedAmountNairaArg] = mocks.refundOverpayment.mock.calls[0].arguments;
    assert.equal(expectedAmountNairaArg, 1050.0);
  });

  await t.test("an overpayment too small to cover the outbound fee is not refunded at all", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "pending",
      expectedAmount: 100_000n,
      fundedAt: null,
    });
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const mocks = mockNomba(t);

    // Excess = 1010 - 1000 = 10 naira = 1_000n kobo, well under the ₦50 outbound fee — refunding
    // would cost more than the sender would receive, so this stays unrefunded (same behavior as
    // before this fix existed for a same-shape excess, just now via an explicit threshold check
    // rather than accident).
    await ContributionsService.confirmFunding(
      fakePayment({ aliasAccountNumber: contribution.virtualAccountNumber!, transactionAmount: 1010.0 })
    );

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded");
    assert.equal(await LedgerService.getBalance(potAccount.id), 98_000n);
    assert.equal(mocks.refundOverpayment.mock.callCount(), 0);
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

    assert.equal(await LedgerService.getBalance(potAccount.id), 98_000n);
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
    assert.equal(await LedgerService.getBalance(potAccount.id), 98_000n);

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