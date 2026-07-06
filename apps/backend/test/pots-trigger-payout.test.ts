import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { drainQueues, getTransferQueueJobs, closeQueues } from "./helpers/queue";
import { mockNomba } from "./helpers/mocks";
import { createAuthenticatedUser, createTestPot, seedPotBalance, forceActionOtpCode } from "./helpers/factories";
import { PotsService } from "../src/modules/pots/pots.service";
import db, { pots } from "../src/db";
import { eq } from "drizzle-orm";
import { TransferJob, TransferPriority } from "../src/queues/names";
import type { FastifyInstance } from "fastify";

/** Opens a draft pot straight to 'open' via direct DB write — bypassing the activate route/handler, which isn't the thing under test here. */
async function openPot(potId: string) {
  await db.update(pots).set({ status: "open", activatedAt: new Date() }).where(eq(pots.id, potId));
}

describe("manual payout trigger", () => {
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

  test("full flow: request OTP, trigger payout, job lands on the real transfers queue with correct priority/amount", async (t) => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 500_000n); // ₦5,000.00

    mockNomba(t);
    const code = "123456";
    const destination = { destinationAccount: "1000000001", destinationBank: "000013" };

    // Real request — inserts the OTP row for real. Its own HTTP outcome
    // (which depends on whether email sending succeeds in this
    // environment) is irrelevant here; see forceActionOtpCode's doc
    // comment for why we don't assert on it.
    await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout/otp`,
      headers: { authorization: authHeader },
      payload: destination,
    });
    await forceActionOtpCode(admin.id, "trigger_payout", pot.id, destination, code);

    const triggerResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout`,
      headers: { authorization: authHeader, "idempotency-key": randomUUID() },
      payload: { ...destination, otpCode: code },
    });

    assert.equal(triggerResponse.statusCode, 202);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => j.data.kind === "payout" && "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 1);
    assert.equal(potJobs[0].name, TransferJob.PAYOUT);
    assert.equal(potJobs[0].priority, TransferPriority.PAYOUT);
    // No `amount` was sent in the trigger body, so postDisbursement uses
    // the pot's FULL current balance, not a partial amount.
    assert.equal(potJobs[0].data.amount, "500000");
    assert.equal(potJobs[0].data.destinationAccount, destination.destinationAccount);

    const [updatedPot] = await db.select().from(pots).where(eq(pots.id, pot.id));
    assert.equal(updatedPot.pendingOperation, "payout");
    assert.equal(updatedPot.pendingOperationLegCount, 1);
  });

  test("an OTP issued for one destination cannot be used to trigger a payout to a different destination", async (t) => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 500_000n);

    mockNomba(t);
    const code = "123456";
    const requestedDestination = { destinationAccount: "1000000001", destinationBank: "000013" };

    await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout/otp`,
      headers: { authorization: authHeader },
      payload: requestedDestination,
    });
    // Force the code to be valid for the REQUESTED destination's context.
    await forceActionOtpCode(admin.id, "trigger_payout", pot.id, requestedDestination, code);

    const triggerResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout`,
      headers: { authorization: authHeader, "idempotency-key": randomUUID() },
      // Different destination than what the code was bound to — contextHash mismatch.
      payload: { destinationAccount: "2000000002", destinationBank: "000014", otpCode: code },
    });

    assert.equal(triggerResponse.statusCode, 400);
    assert.match(triggerResponse.json().message, /incorrect confirmation code/i);

    const jobs = await getTransferQueueJobs();
    assert.equal(jobs.length, 0);
  });

  test("rejects triggering a payout with a wrong OTP", async (t) => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 500_000n);

    mockNomba(t);
    const destination = { destinationAccount: "1000000001", destinationBank: "000013" };

    await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout/otp`,
      headers: { authorization: authHeader },
      payload: destination,
    });
    await forceActionOtpCode(admin.id, "trigger_payout", pot.id, destination, "111111");

    const triggerResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout`,
      headers: { authorization: authHeader, "idempotency-key": randomUUID() },
      payload: { ...destination, otpCode: "999999" },
    });

    assert.equal(triggerResponse.statusCode, 400);
  });

  test("rejects triggering a payout on a pot with zero balance", async (t) => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    // No seedPotBalance call — balance stays 0.

    mockNomba(t);
    const code = "123456";
    const destination = { destinationAccount: "1000000001", destinationBank: "000013" };

    await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout/otp`,
      headers: { authorization: authHeader },
      payload: destination,
    });
    await forceActionOtpCode(admin.id, "trigger_payout", pot.id, destination, code);

    const triggerResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout`,
      headers: { authorization: authHeader, "idempotency-key": randomUUID() },
      payload: { ...destination, otpCode: code },
    });

    assert.equal(triggerResponse.statusCode, 409);
    assert.match(triggerResponse.json().message, /no balance/i);
  });

  test("replaying the same Idempotency-Key + identical body returns the cached result without enqueueing a second job", async (t) => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 500_000n);

    mockNomba(t);
    const code = "123456";
    const destination = { destinationAccount: "1000000001", destinationBank: "000013" };

    await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout/otp`,
      headers: { authorization: authHeader },
      payload: destination,
    });
    await forceActionOtpCode(admin.id, "trigger_payout", pot.id, destination, code);

    const idempotencyKey = randomUUID();
    const payload = { ...destination, otpCode: code };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout`,
      headers: { authorization: authHeader, "idempotency-key": idempotencyKey },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/pots/${pot.id}/payout`,
      headers: { authorization: authHeader, "idempotency-key": idempotencyKey },
      payload,
    });

    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    // Exactly one job, not two — the second call hit the idempotency
    // cache and never re-ran ActionOtpService.verify/PotsService.triggerPayout.
    assert.equal(potJobs.length, 1);
  });

  test("PotsService.triggerPayout rejects a second trigger while one is already in flight (pendingOperation lock)", async (t) => {
    const admin = (await createAuthenticatedUser(app)).user;
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 500_000n);
    mockNomba(t);

    const destination = { destinationAccount: "1000000001", destinationBank: "000013" };

    // First trigger claims the pendingOperation lock and enqueues.
    await PotsService.triggerPayout(pot.id, admin.id, destination);

    // A second trigger before the (never-run, since there's no worker in
    // tests) first one resolves must be rejected — the lock is claimed at
    // enqueue time, not at worker completion.
    await assert.rejects(() => PotsService.triggerPayout(pot.id, admin.id, destination), /already in flight/i);

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 1);
  });

  test("a partial-amount payout enqueues exactly that amount, not the full balance", async (t) => {
    const admin = (await createAuthenticatedUser(app)).user;
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 500_000n);
    mockNomba(t);

    await PotsService.triggerPayout(
      pot.id,
      admin.id,
      { destinationAccount: "1000000001", destinationBank: "000013" },
      200_000n
    );

    const jobs = await getTransferQueueJobs();
    const potJobs = jobs.filter((j) => "potId" in j.data && j.data.potId === pot.id);
    assert.equal(potJobs.length, 1);
    assert.equal(potJobs[0].data.amount, "200000");
  });

  test("rejects a partial amount greater than the pot's current balance", async (t) => {
    const admin = (await createAuthenticatedUser(app)).user;
    const pot = await createTestPot(admin.id, { payoutMode: "manual" });
    await openPot(pot.id);
    await seedPotBalance(pot.id, 100_000n);
    mockNomba(t);

    await assert.rejects(
      () =>
        PotsService.triggerPayout(
          pot.id,
          admin.id,
          { destinationAccount: "1000000001", destinationBank: "000013" },
          200_000n
        ),
      /exceeds the pot's current balance/i
    );
  });
});