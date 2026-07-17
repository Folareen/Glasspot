import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { drainQueues, getTransferQueueJobs, closeQueues } from "./helpers/queue";
import { createAuthenticatedUser, createTestPot, seedPotBalance } from "./helpers/factories";
import { TargetBasedPayoutService } from "../src/modules/pots/target-based-payout.service";
import { OUTBOUND_FEE } from "../src/lib/fees";
import db, { pots, targetBasedPayoutConfigs } from "../src/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

async function openPot(potId: string) {
  await db.update(pots).set({ status: "open", activatedAt: new Date() }).where(eq(pots.id, potId));
}

async function insertTargetBasedConfig(
  potId: string,
  overrides: Partial<typeof targetBasedPayoutConfigs.$inferInsert> = {}
) {
  const [config] = await db
    .insert(targetBasedPayoutConfigs)
    .values({
      potId,
      destinationAccount: "1000000001",
      destinationBank: "000013",
      destinationAccountName: "Test Destination",
      ...overrides,
    })
    .returning();
  return config;
}

describe("TargetBasedPayoutService", () => {
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
    await drainQueues();
  });

  describe("checkAndFireForPot — eligibility query", () => {
    test("a never-fired amount-only config fires once the balance reaches the target", async () => {
      const { user: admin } = await createAuthenticatedUser(app);
      const pot = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(pot.id);
      await insertTargetBasedConfig(pot.id, { targetAmount: 100_000n }); // ₦1,000
      await seedPotBalance(pot.id, 100_000n);

      await TargetBasedPayoutService.checkAndFireForPot(pot.id);

      const jobs = await getTransferQueueJobs();
      assert.equal(jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id).length, 1);
    });

    test("a pure-amount config (no targetDate) that already fired once fires AGAIN once the balance reaches the target a second time", async () => {
      const { user: admin } = await createAuthenticatedUser(app);
      const pot = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(pot.id);
      // fired=true already, targetDate never set — exactly the repeat-fire case: the pot paid out
      // once before, stayed open, and new contributions have brought the balance back up to target.
      await insertTargetBasedConfig(pot.id, { targetAmount: 100_000n, fired: true, firedAt: new Date() });
      await seedPotBalance(pot.id, 100_000n);

      await TargetBasedPayoutService.checkAndFireForPot(pot.id);

      const jobs = await getTransferQueueJobs();
      assert.equal(
        jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id).length,
        1,
        "a fired-but-dateless config must still be eligible to fire again"
      );
    });

    test("the enqueued payout amount is the full balance net of the ₦50 outbound fee, not the raw balance", async () => {
      // Regression: target_based disburses the pot's FULL balance (see postDisbursement, unlike
      // recurring/scheduled's fixed amounts), and that balance must be netted down by OUTBOUND_FEE
      // before being enqueued — a prior bug enqueued the raw balance itself, which then failed
      // downstream once the worker tried to debit balance + OUTBOUND_FEE from a pot that only had
      // exactly `balance` available.
      const { user: admin } = await createAuthenticatedUser(app);
      const pot = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(pot.id);
      await insertTargetBasedConfig(pot.id, { targetAmount: 100_000n });
      await seedPotBalance(pot.id, 100_000n);

      await TargetBasedPayoutService.checkAndFireForPot(pot.id);

      const jobs = await getTransferQueueJobs();
      const potJob = jobs.find((j) => "potId" in j.data && j.data.potId === pot.id);
      assert.ok(potJob, "expected a payout job to be enqueued");
      assert.ok("amount" in potJob!.data);
      assert.equal(potJob!.data.amount, (100_000n - OUTBOUND_FEE).toString());
    });

    test("a config with a targetDate that already fired is not reconsidered even if its pot were somehow still open", async () => {
      const { user: admin } = await createAuthenticatedUser(app);
      const pot = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(pot.id);
      // In practice applyFired closes the pot the moment a dated config fires, so this combination
      // (open pot, fired dated config) shouldn't arise — asserts the query's own exclusion holds
      // regardless, as defense in depth.
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await insertTargetBasedConfig(pot.id, { targetDate: pastDate, fired: true, firedAt: new Date() });
      await seedPotBalance(pot.id, 100_000n);

      await TargetBasedPayoutService.checkAndFireForPot(pot.id);

      const jobs = await getTransferQueueJobs();
      assert.equal(jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id).length, 0);
    });
  });

  describe("applyFired — closing behavior", () => {
    test("a targetDate config closes its pot on fire; a pure-amount config leaves it open", async () => {
      const { user: admin } = await createAuthenticatedUser(app);

      const potWithDate = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(potWithDate.id);
      const dateConfig = await insertTargetBasedConfig(potWithDate.id, { targetDate: new Date() });

      const potAmountOnly = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(potAmountOnly.id);
      const amountConfig = await insertTargetBasedConfig(potAmountOnly.id, { targetAmount: 100_000n });

      await TargetBasedPayoutService.applyFired(dateConfig.id);
      await TargetBasedPayoutService.applyFired(amountConfig.id);

      const [updatedDatePot] = await db.select().from(pots).where(eq(pots.id, potWithDate.id));
      assert.equal(updatedDatePot.status, "closed");
      assert.ok(updatedDatePot.closedAt);

      const [updatedAmountPot] = await db.select().from(pots).where(eq(pots.id, potAmountOnly.id));
      assert.equal(updatedAmountPot.status, "open");

      const [updatedDateConfig] = await db
        .select()
        .from(targetBasedPayoutConfigs)
        .where(eq(targetBasedPayoutConfigs.id, dateConfig.id));
      assert.equal(updatedDateConfig.fired, true);
      assert.ok(updatedDateConfig.firedAt);
    });

    test("does not close a pot that already has a payout/refund in flight from elsewhere", async () => {
      const { user: admin } = await createAuthenticatedUser(app);
      const pot = await createTestPot(admin.id, { payoutMode: "target_based" });
      await openPot(pot.id);
      await db.update(pots).set({ pendingOperation: "refund", pendingOperationLegCount: 1 }).where(eq(pots.id, pot.id));
      const dateConfig = await insertTargetBasedConfig(pot.id, { targetDate: new Date() });

      await TargetBasedPayoutService.applyFired(dateConfig.id);

      const [updatedPot] = await db.select().from(pots).where(eq(pots.id, pot.id));
      assert.equal(updatedPot.status, "open");
    });
  });
});
