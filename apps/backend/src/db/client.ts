import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";
import env from "@/config/env";

export const connection = postgres(env.DATABASE_URL, {
  max: env.DB_MIGRATING ? 1 : undefined,
});

export const db = drizzle(connection, {
  schema,
  // Query logging prints bound parameters to stdout, including
  // passwordHash/codeHash/refreshTokenHash on auth-flow queries — never
  // enable it in production.
  logger: false
});

export type db = typeof db;

export default db;
