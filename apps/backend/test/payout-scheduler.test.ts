import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { drainQueues, getTransferQueueJobs, closeQueues } from "./helpers/queue";
import { createTestUser, createTestPot, seedPotBalance } from "./helpers/factories";
import { PayoutSchedulerService } from "../src/modules/pots/payout-scheduler.service";
import db, { pots, recurringPayoutConfigs, scheduledPayoutConfigs, scheduledPayoutLegs } from "../src/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

async function openPot(potId: string) {
  await db.update(pots).set({ status: "open", activatedAt: new Date() }).where(eq(pots.id, potId));
}

async function insertRecurringConfig(
  potId: string,
  overrides: Partial<typeof recurringPayoutConfigs.$inferInsert> = {}
) {
  const [config] = await db
    .insert(recurringPayoutConfigs)
    .values({
      potId,
      destinationAccount: "1000000001",
      destinationBank: "000013",
      destinationAccountName: "Test Destination",
      amount: 50_000n,
      intervalDays: 30,
      nextRunAt: new Date(Date.now() - 60 * 1000), // already due
      ...overrides,
    })
    .returning();
  return config;
}

async function insertScheduledConfig(potId: string, ordered: boolean) {
  const [config] = await db.insert(scheduledPayoutConfigs).values({ potId, ordered }).returning();
  return config;
}

async function insertScheduledLeg(
  scheduledConfigId: string,
  overrides: Partial<typeof scheduledPayoutLegs.$inferInsert> = {}
) {
  const [leg] = await db
    .insert(scheduledPayoutLegs)
    .values({
      scheduledConfigId,
      sequenceOrder: 0,
      destinationAccount: "1000000001",
      destinationBank: "000013",
      destinationAccountName: "Test Destination",
      amount: 50_000n,
      scheduledDate: new Date(Date.now() - 60 * 1000), // already due
      ...overrides,
    })
    .returning();
  return leg;
}

describe("PayoutSchedulerService", () => {
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

  describe("fireDueRecurringPayouts", () => {
    test("a funded, due recurring config is enqueued", async () => {
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "recurring" });
      await openPot(pot.id);
      await insertRecurringConfig(pot.id, { amount: 50_000n });
      await seedPotBalance(pot.id, 100_000n); // covers amount + OUTBOUND_FEE comfortably

      const result = await PayoutSchedulerService.fireDueRecurringPayouts();

      assert.equal(result.fired, 1);
      assert.equal(result.skipped, 0);
      const jobs = await getTransferQueueJobs();
      assert.equal(jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id).length, 1);
    });

    test("a config funded to exactly the payout amount but not the outbound fee is skipped, not fired", async () => {
      // Regression for the fee-aware underfunded check: balance covers config.amount exactly but
      // not + OUTBOUND_FEE, so this must be skipped rather than enqueued and failing downstream.
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "recurring" });
      await openPot(pot.id);
      await insertRecurringConfig(pot.id, { amount: 50_000n });
      await seedPotBalance(pot.id, 50_000n); // exactly config.amount, no room for OUTBOUND_FEE

      const result = await PayoutSchedulerService.fireDueRecurringPayouts();

      assert.equal(result.fired, 0);
      assert.equal(result.skipped, 1);
      const jobs = await getTransferQueueJobs();
      assert.equal(jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id).length, 0);
    });

    test("a config not yet due (nextRunAt in the future) is not considered", async () => {
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "recurring" });
      await openPot(pot.id);
      await insertRecurringConfig(pot.id, { amount: 50_000n, nextRunAt: new Date(Date.now() + 60 * 60 * 1000) });
      await seedPotBalance(pot.id, 100_000n);

      const result = await PayoutSchedulerService.fireDueRecurringPayouts();

      assert.equal(result.fired, 0);
      assert.equal(result.skipped, 0);
    });
  });

  describe("fireDueScheduledLegs — ordered", () => {
    test("only the lowest-sequence unfired due leg fires; later legs wait", async () => {
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "scheduled" });
      await openPot(pot.id);
      const config = await insertScheduledConfig(pot.id, true);
      await insertScheduledLeg(config.id, { sequenceOrder: 0, amount: 30_000n });
      await insertScheduledLeg(config.id, { sequenceOrder: 1, amount: 30_000n });
      await seedPotBalance(pot.id, 100_000n);

      const result = await PayoutSchedulerService.fireDueScheduledLegs();

      assert.equal(result.fired, 1);
      const jobs = await getTransferQueueJobs();
      assert.equal(jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id).length, 1);
    });
  });

  describe("fireDueScheduledLegs — unordered fan-out", () => {
    test("every due leg fires together in one sweep, sharing one pendingOperation lock", async () => {
      // Regression: previously only the FIRST due leg in a sweep could ever claim the pot's
      // single-leg pendingOperation lock — every other due leg in the same sweep was skipped and
      // had to wait for a separate future sweep. Now all due legs in one unordered config fire in
      // the same pass via a shared fan-out lock (pendingOperationLegCount = legs.length).
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "scheduled" });
      await openPot(pot.id);
      const config = await insertScheduledConfig(pot.id, false);
      await insertScheduledLeg(config.id, { sequenceOrder: 0, amount: 20_000n });
      await insertScheduledLeg(config.id, { sequenceOrder: 1, amount: 20_000n });
      await insertScheduledLeg(config.id, { sequenceOrder: 2, amount: 20_000n });
      await seedPotBalance(pot.id, 100_000n); // comfortably covers all 3 legs + 3x OUTBOUND_FEE

      const result = await PayoutSchedulerService.fireDueScheduledLegs();

      assert.equal(result.fired, 3);
      assert.equal(result.skipped, 0);
      const jobs = await getTransferQueueJobs();
      const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
      assert.equal(potJobs.length, 3);
      assert.ok(
        potJobs.every((j) => "isFanOutLeg" in j.data && j.data.isFanOutLeg === true),
        "every leg in the batch should be marked isFanOutLeg so the worker decrements rather than clears the shared lock"
      );

      const [updatedPot] = await db.select().from(pots).where(eq(pots.id, pot.id));
      assert.equal(updatedPot.pendingOperation, "payout");
      assert.equal(updatedPot.pendingOperationLegCount, 3);
    });

    test("a leg that doesn't fit after earlier legs reserve their share is skipped, not blocking the others", async () => {
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "scheduled" });
      await openPot(pot.id);
      const config = await insertScheduledConfig(pot.id, false);
      // Two legs of 40_000n each (+ OUTBOUND_FEE 5_000n = 45_000n reserved each) fit in 90_000n;
      // a third leg would need another 45_000n, which the remaining 10_000n can't cover.
      await insertScheduledLeg(config.id, { sequenceOrder: 0, amount: 40_000n });
      await insertScheduledLeg(config.id, { sequenceOrder: 1, amount: 40_000n });
      await insertScheduledLeg(config.id, { sequenceOrder: 2, amount: 40_000n });
      await seedPotBalance(pot.id, 100_000n);

      const result = await PayoutSchedulerService.fireDueScheduledLegs();

      assert.equal(result.fired, 2);
      assert.equal(result.skipped, 1);

      const legs = await db
        .select()
        .from(scheduledPayoutLegs)
        .where(eq(scheduledPayoutLegs.scheduledConfigId, config.id));
      // fired legs stay unfired at enqueue time (only flipped by mark_scheduled_leg_fired once the
      // worker confirms the transfer succeeded) — this just confirms the DB rows themselves weren't
      // mutated here, the "fired" count above is purely an enqueue count.
      assert.ok(legs.every((l) => l.fired === false));
    });

    test("no legs fit at all — nothing is enqueued and the lock is never claimed", async () => {
      const admin = await createTestUser();
      const pot = await createTestPot(admin.id, { payoutMode: "scheduled" });
      await openPot(pot.id);
      const config = await insertScheduledConfig(pot.id, false);
      await insertScheduledLeg(config.id, { sequenceOrder: 0, amount: 50_000n });
      await seedPotBalance(pot.id, 10_000n); // nowhere near amount + OUTBOUND_FEE

      const result = await PayoutSchedulerService.fireDueScheduledLegs();

      assert.equal(result.fired, 0);
      assert.equal(result.skipped, 1);
      const [updatedPot] = await db.select().from(pots).where(eq(pots.id, pot.id));
      assert.equal(updatedPot.pendingOperation, null);
    });
  });
});
