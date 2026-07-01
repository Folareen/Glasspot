import db from "../db/index.js";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const dbStatus = await checkDb();
    return { status: "ok", db: dbStatus };
  });
}

async function checkDb(): Promise<"ok" | "unreachable"> {
  try {
    await db.execute(sql`select 1`);
    return "ok";
  } catch {
    return "unreachable";
  }
}
