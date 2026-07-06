/**
 * Test-only DB helper. Assumes a real Postgres instance is already migrated
 * (via your normal `drizzle-kit migrate` / whatever you run against
 * DATABASE_URL) — this file does NOT run migrations, it only truncates
 * between tests.
 *
 * Point DATABASE_URL at a dedicated test database before running tests,
 * e.g.:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/glasspot_test
 *
 * IMPORTANT: never point this at a database you care about — resetDb()
 * truncates every table in the public schema.
 */
import db from "../../src/db";
import { sql } from "drizzle-orm";

/**
 * Truncates every user table in the public schema (except drizzle's own
 * migrations bookkeeping table) with RESTART IDENTITY CASCADE. Built
 * dynamically from information_schema rather than a hardcoded table list,
 * so it doesn't silently miss a table (accounts, ledger_entries, balances,
 * idempotency_keys, etc.) that isn't reflected in this test suite yet.
 */
export async function resetDb(): Promise<void> {
  const result = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '__drizzle%'
  `);

  // db.execute()'s return shape differs by driver: drizzle-orm/node-postgres
  // wraps rows in `.rows`, drizzle-orm/postgres-js returns the array
  // directly. Handle both rather than assuming one, so this doesn't
  // silently throw "Cannot read properties of undefined" on whichever
  // driver this project actually uses.
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as {
    tablename: string;
  }[];
  const names = rows.map((r) => r.tablename);

  if (names.length === 0) return;

  const identifiers = names.map((n) => sql.identifier(n));
  await db.execute(sql`TRUNCATE TABLE ${sql.join(identifiers, sql`, `)} RESTART IDENTITY CASCADE`);
}

/** Closes the underlying pg pool — call once per test file in an `after` hook, not per-test, or you'll exhaust connections across files running in parallel. */
export async function closeDb(): Promise<void> {
  // @ts-expect-error - client.ts's default export is the drizzle instance;
  // the underlying pg Pool is expected to be reachable via db.$client per
  // drizzle-orm/node-postgres's documented shape. If your client.ts wraps
  // this differently, swap this line for whatever it exports to close the
  // pool (e.g. an explicitly exported `pool`).
  await db.$client.end();
}