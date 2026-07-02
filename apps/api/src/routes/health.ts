import db from "@glasspot/db";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/** Registers GET /health, which reports overall status plus a DB connectivity check. */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const dbStatus = await checkDb();
    return { status: "ok", db: dbStatus };
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
