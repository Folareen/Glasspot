import db from "@/db";
import redis from "@/config/redis";
import { payoutCronQueue } from "@/queues/queues";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/** Registers GET /health, which reports overall status plus DB, Redis, and cron scheduler checks. */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const [dbStatus, redisStatus, cronStatus] = await Promise.all([
      checkDb(),
      checkRedis(),
      checkCron(),
    ]);
    const allOk = dbStatus === "ok" && redisStatus === "ok" && cronStatus.status === "ok";
    return { status: allOk ? "ok" : "degraded", db: dbStatus, redis: redisStatus, cron: cronStatus };
  });
}

/** Runs a trivial query to confirm the DB connection is reachable, returning "unreachable" instead of throwing on failure. */
async function checkDb(): Promise<"ok" | "unreachable"> {
  try {
    await db.execute(sql`select 1`);
    return "ok";
  } catch {
    return "unreachable";
  }
}

/** Pings Redis to confirm it's reachable from the API process. */
async function checkRedis(): Promise<"ok" | "unreachable"> {
  try {
    await redis.ping();
    return "ok";
  } catch {
    return "unreachable";
  }
}

type CronStatus = {
  status: "ok" | "unreachable" | "not_registered" | "stalled";
  schedulers?: number;
};

// The worker process (src/workers/worker.ts) that actually runs these jobs is
// a separate service, so this can't confirm it's alive — only that the cron
// schedulers this API process registered on boot (CronSchedulerService) still
// exist in Redis and are due to fire on schedule. If a scheduler's next run
// is more than an hour past due, nothing is consuming it: either the worker
// service is down or stuck, since these jobs are staggered once a day.
async function checkCron(): Promise<CronStatus> {
  const OVERDUE_GRACE_MS = 60 * 60 * 1000;
  try {
    const schedulers = await payoutCronQueue.getJobSchedulers();
    if (schedulers.length === 0) return { status: "not_registered", schedulers: 0 };

    const now = Date.now();
    const stalled = schedulers.some((s) => typeof s.next === "number" && now - s.next > OVERDUE_GRACE_MS);
    return { status: stalled ? "stalled" : "ok", schedulers: schedulers.length };
  } catch {
    return { status: "unreachable" };
  }
}
