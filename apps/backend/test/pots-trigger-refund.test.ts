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
    // drained part of the pot before this refund fires. Each leg is split
    // pro-rata against the FULL balance first, then loses only its OWN flat
    // ₦50 outbound fee (see fees.ts's OUTBOUND_FEE) — never a shared pool of
    // every leg's fee split proportionally, which would make A subsidize
    // part of B's fee too:
    // A: floor(60000 * 80001 / 100000) - 5000 = 48000 - 5000 = 43000
    // B: floor(40000 * 80001 / 100000) - 5000 = 32000 - 5000 = 27000
    // sum = 70000, 1 kobo short of the pre-fee split (80001 - 80000) — that
    // remainder goes entirely to A (the largest share) via distributeExactly
    // BEFORE the fee is subtracted, so it lands in A's pre-fee amount.
    await seedPotBalance(pot.id, 80_001n);

    await PotsService.triggerRefund(pot.id, admin.id);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 2);

    const jobA = potJobs.find((j) => "destinationAccount" in j.data && j.data.destinationAccount === "1111111111");
    const jobB = potJobs.find((j) => "destinationAccount" in j.data && j.data.destinationAccount === "2222222222");

    assert.ok(jobA, "expected a leg to contributor A's refund account");
    assert.ok(jobB, "expected a leg to contributor B's refund account");
    assert.equal(jobA!.data.amount, "43001");
    assert.equal(jobB!.data.amount, "27000");

    const totalDisbursed = BigInt(jobA!.data.amount) + BigInt(jobB!.data.amount);
    assert.equal(totalDisbursed, 70_001n); // balance minus both legs' own ₦50 fee (80_001 - 2*5000)

    const [updatedPot] = await db.select().from(pots).where(eq(pots.id, pot.id));
    assert.equal(updatedPot.pendingOperation, "refund");
    assert.equal(updatedPot.pendingOperationLegCount, 2);
  });

  await t.test("three-way split with an uneven remainder still sums to exactly the distributable balance", async () => {
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id, { refundType: "contributors" });
    await openPot(pot.id);

    // 3 equal-thirds contributors against a balance not evenly divisible by
    // 3 kobo. Each leg is split pro-rata against the full 115_000 balance
    // (floor(100000 * 115000 / 300000) = 38333 each, 1 kobo short of 115000
    // pre-fee — the remainder goes to the largest share via distributeExactly
    // before fees are subtracted), then each loses its own ₦50 fee:
    // 38334 - 5000 = 33334 (the leg that absorbed the remainder), the other
    // two 38333 - 5000 = 33333 each.
    const contributorA = await createTestUser();
    const contributorB = await createTestUser();
    const contributorC = await createTestUser();
    await createFundedContribution(pot.id, {
      contributorUserId: contributorA.id,
      expectedAmount: 100_000n,
      refundAccountNumber: "6000000006",
      refundAccountName: "Contributor A",
      refundBank: "000018",
    });
    await createFundedContribution(pot.id, {
      contributorUserId: contributorB.id,
      expectedAmount: 100_000n,
      refundAccountNumber: "7000000007",
      refundAccountName: "Contributor B",
      refundBank: "000019",
    });
    await createFundedContribution(pot.id, {
      contributorUserId: contributorC.id,
      expectedAmount: 100_000n,
      refundAccountNumber: "8000000008",
      refundAccountName: "Contributor C",
      refundBank: "000020",
    });

    await seedPotBalance(pot.id, 115_000n);

    await PotsService.triggerRefund(pot.id, admin.id);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 3);

    const totalDisbursed = potJobs.reduce((sum, j) => sum + BigInt(j.data.amount as string), 0n);
    assert.equal(totalDisbursed, 100_000n); // 115_000 balance minus all 3 legs' own ₦50 fee (3*5000)

    const amounts = potJobs.map((j) => BigInt(j.data.amount as string)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(amounts, [33333n, 33333n, 33334n]); // one leg absorbs the 1-kobo pre-fee remainder
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

    // Balance exactly equals total contributed, split 60/40 across the two
    // funding payments against the FULL 100_000 balance first (60000 /
    // 40000, both exact), then each of the 2 legs loses its own flat ₦50
    // outbound fee: 55_000 / 35_000.
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
    assert.equal(legToPayerOne!.data.amount, "55000");
    assert.equal(legToPayerTwo!.data.amount, "35000");
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
    // postDisbursement nets the flat ₦50 outbound fee out of the balance (see fees.ts's
    // OUTBOUND_FEE) rather than adding it on top: 30_000 - 5_000 = 25_000.
    assert.equal(potJobs[0].data.amount, "25000");
  });

  await t.test("rejects an admin refund when the admin has no defaultRefundAccount on file", async () => {
    const admin = await createTestUser(); // no defaultRefundAccount/Bank
    const pot = await createTestPot(admin.id, { refundType: "admin" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 30_000n);

    await assert.rejects(() => PotsService.triggerRefund(pot.id, admin.id), /set a default refund bank account/i);
  });
});