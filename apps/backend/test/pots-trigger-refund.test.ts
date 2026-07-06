import test from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { drainQueues, getTransferQueueJobs, closeQueues } from "./helpers/queue";
import {
  createTestUser,
  createTestPot,
  createFundedContribution,
  createContributionPayment,
  seedPotBalance,
} from "./helpers/factories";
import { PotsService } from "../src/modules/pots/pots.service";
import db, { pots } from "../src/db";
import { eq } from "drizzle-orm";

async function openPot(potId: string) {
  await db.update(pots).set({ status: "open", activatedAt: new Date() }).where(eq(pots.id, potId));
}

test("PotsService.triggerRefund — refundType='contributors' fan-out math", async (t) => {
  const app = createTestApp();
  await app.ready();

  t.after(async () => {
    await app.close();
    await closeDb();
    await closeQueues();
  });

  t.beforeEach(async () => {
    await resetDb();
    await drainQueues();
  });

  await t.test("splits pro-rata by contributed amount, truncating down and leaving a small remainder uncollected", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id, { refundType: "contributors" });
    await openPot(pot.id);

    // contributorA contributed 60% of the total, contributorB 40%.
    const contributorA = await createTestUser();
    const contributorB = await createTestUser();

    await createFundedContribution(pot.id, {
      contributorUserId: contributorA.id,
      expectedAmount: 60_000n,
      refundAccountNumber: "1111111111",
      refundAccountName: "Contributor A",
      refundBank: "000013",
    });
    await createFundedContribution(pot.id, {
      contributorUserId: contributorB.id,
      expectedAmount: 40_000n,
      refundAccountNumber: "2222222222",
      refundAccountName: "Contributor B",
      refundBank: "000014",
    });

    // Balance is 80_001, not 100_000 — simulates a payout having already
    // drained part of the pot before this refund fires. Deliberately not
    // evenly divisible by 60/40 so truncation is actually exercised:
    // A: floor(60000 * 80001 / 100000) = 48000
    // B: floor(40000 * 80001 / 100000) = 32000
    // sum = 80000, leaving exactly 1 kobo uncollected — matching
    // postContributorsRefund's documented "integer-kobo division truncates
    // down" behavior.
    await seedPotBalance(pot.id, 80_001n);

    await PotsService.triggerRefund(pot.id, admin.id);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 2);

    const jobA = potJobs.find((j) => "destinationAccount" in j.data && j.data.destinationAccount === "1111111111");
    const jobB = potJobs.find((j) => "destinationAccount" in j.data && j.data.destinationAccount === "2222222222");

    assert.ok(jobA, "expected a leg to contributor A's refund account");
    assert.ok(jobB, "expected a leg to contributor B's refund account");
    assert.equal(jobA!.data.amount, "48000");
    assert.equal(jobB!.data.amount, "32000");

    const totalDisbursed = BigInt(jobA!.data.amount) + BigInt(jobB!.data.amount);
    assert.equal(totalDisbursed, 80_000n); // 1 kobo short of the full 80_001 balance, by design

    const [updatedPot] = await db.select().from(pots).where(eq(pots.id, pot.id));
    assert.equal(updatedPot.pendingOperation, "refund");
    assert.equal(updatedPot.pendingOperationLegCount, 2);
  });

  await t.test("a contributor with no refund account on file is refunded per-payment, split proportionally to each payment", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id, { refundType: "contributors" });
    await openPot(pot.id);

    // Anonymous contribution (contributorUserId null): no refund account,
    // funded by two separate transfers from two different sender accounts.
    const contribution = await createFundedContribution(pot.id, {
      contributorUserId: null,
      expectedAmount: 100_000n,
      refundAccountNumber: null,
      refundAccountName: null,
      refundBank: null,
    });
    await createContributionPayment(contribution.id, {
      amount: 60_000n,
      senderAccountNumber: "3000000003",
      senderBankCode: "000015",
      senderName: "Payer One",
    });
    await createContributionPayment(contribution.id, {
      amount: 40_000n,
      senderAccountNumber: "4000000004",
      senderBankCode: "000016",
      senderName: "Payer Two",
    });

    // Balance exactly equals total contributed, so this group's full
    // share is the full 100_000 balance, split 60/40 across its two
    // funding payments.
    await seedPotBalance(pot.id, 100_000n);

    await PotsService.triggerRefund(pot.id, admin.id);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 2);

    const legToPayerOne = potJobs.find(
      (j) => "destinationAccount" in j.data && j.data.destinationAccount === "3000000003"
    );
    const legToPayerTwo = potJobs.find(
      (j) => "destinationAccount" in j.data && j.data.destinationAccount === "4000000004"
    );

    assert.ok(legToPayerOne);
    assert.ok(legToPayerTwo);
    assert.equal(legToPayerOne!.data.amount, "60000");
    assert.equal(legToPayerTwo!.data.amount, "40000");
    // Anonymous group: contributorUserId must never be set on the job,
    // even though it belongs to a specific real bank sender.
    assert.equal("contributorUserId" in legToPayerOne!.data ? legToPayerOne!.data.contributorUserId : undefined, undefined);
  });

  await t.test("rejects triggering a contributors refund with no funded contributions", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id, { refundType: "contributors" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 10_000n);

    await assert.rejects(() => PotsService.triggerRefund(pot.id, admin.id), /no funded contributions/i);
  });

  await t.test("rejects a contributor with no refund account and no recorded payments (data-inconsistency guard)", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id, { refundType: "contributors" });
    await openPot(pot.id);
    await createFundedContribution(pot.id, {
      contributorUserId: null,
      expectedAmount: 50_000n,
      refundAccountNumber: null,
      refundAccountName: null,
      refundBank: null,
    });
    // No contributionPayments rows created for it — inconsistent data.
    await seedPotBalance(pot.id, 50_000n);

    await assert.rejects(() => PotsService.triggerRefund(pot.id, admin.id), /no refund destination and no recorded payments/i);
  });

  await t.test("refundType='admin' disburses to the triggering admin's own defaultRefundAccount, not to contributors", async () => {
    const admin = await createTestUser({
      defaultRefundAccount: "5000000005",
      defaultRefundBank: "000017",
    });
    const pot = await createTestPot(admin.id, { refundType: "admin" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 30_000n);

    await PotsService.triggerRefund(pot.id, admin.id);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 1);
    assert.equal(potJobs[0].data.destinationAccount, "5000000005");
    assert.equal(potJobs[0].data.amount, "30000");
  });

  await t.test("rejects an admin refund when the admin has no defaultRefundAccount on file", async () => {
    const admin = await createTestUser(); // no defaultRefundAccount/Bank
    const pot = await createTestPot(admin.id, { refundType: "admin" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 30_000n);

    await assert.rejects(() => PotsService.triggerRefund(pot.id, admin.id), /set a default refund bank account/i);
  });
});