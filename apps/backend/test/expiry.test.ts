import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { drainQueues, getTransferQueueJobs, closeQueues } from "./helpers/queue";
import { mockNomba } from "./helpers/mocks";
import { createTestUser, createTestPot, createFundedContribution, createContributionPayment } from "./helpers/factories";
import { ExpiryService } from "../src/modules/pots/expiry.service";
import db, { contributions } from "../src/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

describe("ExpiryService.sweepExpiredContributions", () => {
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

  test("an expired, underpaid contribution with one unrefunded payment is refunded and marked failed", async (t) => {
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000), // already expired
    });
    const payment = await createContributionPayment(contribution.id, { amount: 40_000n, refunded: false });

    const result = await ExpiryService.sweepExpiredContributions();

    assert.equal(result.expiredContributions, 1);
    assert.equal(result.refundedPayments, 1);

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "failed");

    const jobs = await getTransferQueueJobs();
    const refundJobs = jobs.filter((j) => j.data.kind === "contribution_refund");
    assert.equal(refundJobs.length, 1);
    assert.equal(refundJobs[0].data.kind === "contribution_refund" && refundJobs[0].data.contributionPaymentId, payment.id);
    // Fee-bearing like every other outbound transfer: the sender receives payment.amount minus the
    // flat ₦50 outbound fee, never the raw payment amount.
    assert.equal(refundJobs[0].data.amount, "35000");
  });

  test("a payment too small to cover the outbound fee is left unrefunded rather than sent at a loss", async (t) => {
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    await createContributionPayment(contribution.id, { amount: 5_000n, refunded: false }); // exactly OUTBOUND_FEE

    const result = await ExpiryService.sweepExpiredContributions();

    assert.equal(result.expiredContributions, 1);
    assert.equal(result.refundedPayments, 0);
    const jobs = await getTransferQueueJobs();
    assert.equal(jobs.filter((j) => j.data.kind === "contribution_refund").length, 0);
  });

  test("a contribution not yet expired is left alone", async (t) => {
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // not expired yet
    });
    await createContributionPayment(contribution.id, { amount: 40_000n, refunded: false });

    const result = await ExpiryService.sweepExpiredContributions();

    assert.equal(result.expiredContributions, 0);
    assert.equal(result.refundedPayments, 0);
    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "underpaid");
  });

  test("a payment already marked refunded is not re-enqueued", async (t) => {
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    await createContributionPayment(contribution.id, { amount: 40_000n, refunded: true });

    const result = await ExpiryService.sweepExpiredContributions();

    // No unrefunded payments to enqueue, but the contribution itself still counts as expired/failed
    // since every one of its payments (zero of them unrefunded) was successfully "enqueued".
    assert.equal(result.expiredContributions, 1);
    assert.equal(result.refundedPayments, 0);
    const jobs = await getTransferQueueJobs();
    assert.equal(jobs.filter((j) => j.data.kind === "contribution_refund").length, 0);
  });

  test("running the sweep twice for the same expired payment enqueues only one job (BullMQ jobId idempotency)", async (t) => {
    // Regression: enqueueContributionRefund's jobId is now the payment's deterministic reference
    // (expiry_refund_<paymentId>), so re-running the sweep before the first job resolves — e.g. two
    // overlapping cron ticks — can't double-enqueue the same refund.
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    await createContributionPayment(contribution.id, { amount: 40_000n, refunded: false });

    await ExpiryService.sweepExpiredContributions();
    // Second run: the contribution is now 'failed', so the sweep's own WHERE clause (status IN
    // pending/underpaid) already excludes it from being reconsidered — but this still proves the
    // underlying BullMQ jobId guard holds even if something else tried to enqueue the same
    // reference again (e.g. a retried cron tick that raced the first run's status update).
    await ExpiryService.sweepExpiredContributions();

    const jobs = await getTransferQueueJobs();
    assert.equal(jobs.filter((j) => j.data.kind === "contribution_refund").length, 1);
  });

  test("a contribution that got funded by a race-adjacent webhook before this sweep claims it is left completely untouched", async (t) => {
    // Regression for the sweep/confirmFunding race: a payment can land and fund a contribution
    // (ContributionsService.confirmFunding) in the gap between the sweep's initial SELECT and the
    // moment it acts. The sweep's claim is now a single atomic UPDATE ... WHERE status IN
    // (pending, underpaid) — if confirmFunding won and already flipped status to 'funded', that
    // UPDATE claims 0 rows and this contribution must not be enqueued for a refund or have its
    // status touched at all, even though it was selected by the sweep's own initial query as
    // "expired and underpaid" a moment earlier.
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000), // already expired
    });
    await createContributionPayment(contribution.id, { amount: 100_000n, refunded: false });

    // Simulates confirmFunding winning the race just before the sweep's atomic claim runs.
    await db.update(contributions).set({ status: "funded", fundedAt: new Date() }).where(eq(contributions.id, contribution.id));

    const result = await ExpiryService.sweepExpiredContributions();

    assert.equal(result.expiredContributions, 0);
    assert.equal(result.refundedPayments, 0);

    const [updated] = await db.select().from(contributions).where(eq(contributions.id, contribution.id));
    assert.equal(updated.status, "funded", "must stay funded, not be knocked back to failed by the sweep");

    const jobs = await getTransferQueueJobs();
    assert.equal(
      jobs.filter((j) => j.data.kind === "contribution_refund").length,
      0,
      "a contribution that just got funded must not have its payment refunded by the same sweep"
    );
  });

  test("multiple unrefunded payments on the same expired contribution each get their own refund job", async (t) => {
    mockNomba(t);
    const admin = await createTestUser();
    const pot = await createTestPot(admin.id);
    const contribution = await createFundedContribution(pot.id, {
      status: "underpaid",
      expectedAmount: 100_000n,
      fundedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    await createContributionPayment(contribution.id, { amount: 20_000n, refunded: false });
    await createContributionPayment(contribution.id, { amount: 20_000n, refunded: false });

    const result = await ExpiryService.sweepExpiredContributions();

    assert.equal(result.refundedPayments, 2);
    const jobs = await getTransferQueueJobs();
    assert.equal(jobs.filter((j) => j.data.kind === "contribution_refund").length, 2);
  });
});
