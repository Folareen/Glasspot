import { FastifyReply, FastifyRequest } from "fastify";
import { desc, eq } from "drizzle-orm";
import db, { failedJobs } from "@/db";
import env from "@/config/env";
import redisConnection from "@/config/redis";
import { FailedJobTracker } from "./failed-job-tracker";
import type { FailedJobIdParams } from "./failed-jobs.schema";

/**
 * Same narrow allowlist pattern as banks.controller.ts's
 * BANKS_REFRESH_ALLOWED_USER_IDS — there is no general staff/admin role in
 * this codebase yet (pot-authorization.ts's "admin" is per-pot, not
 * global), so operating on failed_jobs (a cross-pot, money-movement
 * concern) is gated the same way rather than inventing a new role concept.
 */
const FAILED_JOBS_ALLOWED_USER_IDS = new Set(
  env.BANKS_REFRESH_ALLOWED_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean)
);

function assertAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const userId = request.user?.sub;
  if (!userId || !FAILED_JOBS_ALLOWED_USER_IDS.has(userId)) {
    reply.code(403).send({ message: "Not authorized to manage failed jobs" });
    return false;
  }
  return true;
}

/** GET /failed-jobs — lists failed_jobs rows still awaiting action, most recent first. */
export async function listFailedJobsHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!assertAllowed(request, reply)) return;

  const rows = await db.select().from(failedJobs).where(eq(failedJobs.status, "pending")).orderBy(desc(failedJobs.createdAt));
  return reply.code(200).send({ failedJobs: rows });
}

/** POST /failed-jobs/:id/retry — re-enqueues the failed job's original data as a new BullMQ job. */
export async function retryFailedJobHandler(
  request: FastifyRequest<{ Params: FailedJobIdParams }>,
  reply: FastifyReply
) {
  if (!assertAllowed(request, reply)) return;

  const job = await FailedJobTracker.retry(request.params.id, redisConnection);
  if (!job) {
    return reply.code(409).send({ message: "Failed job not found, or already resolved" });
  }
  return reply.code(200).send({ message: "Job re-enqueued", jobId: job.id });
}

/** POST /failed-jobs/:id/ignore — marks the failed job reviewed and deliberately not retried. */
export async function ignoreFailedJobHandler(
  request: FastifyRequest<{ Params: FailedJobIdParams }>,
  reply: FastifyReply
) {
  if (!assertAllowed(request, reply)) return;

  const row = await FailedJobTracker.ignore(request.params.id);
  if (!row) {
    return reply.code(409).send({ message: "Failed job not found, or already resolved" });
  }
  return reply.code(200).send({ message: "Job marked ignored" });
}
