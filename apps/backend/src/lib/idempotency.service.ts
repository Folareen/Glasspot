import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { idempotencyKeys } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";

const KEY_TTL_HOURS = 24;

export class IdempotencyKeyReuseError extends Error {
  statusCode = 409;
  /** Thrown when `key` was already used with a different request (method/path/user/body) — a client bug, not a legitimate retry. */
  constructor() {
    super("Idempotency-Key was already used for a different request");
    this.name = "IdempotencyKeyReuseError";
  }
}

export class IdempotencyInProgressError extends Error {
  statusCode = 409;
  /** Thrown when a request with this key is still being processed — the caller should retry shortly rather than this one blocking/polling. */
  constructor() {
    super("A request with this Idempotency-Key is already in progress, retry shortly");
    this.name = "IdempotencyInProgressError";
  }
}

export class IdempotencyIndeterminateError extends Error {
  statusCode = 409;
  /** Thrown when a prior request with this key failed after an external call may have already gone out — retrying automatically risks double-executing that call, so this key is permanently rejected pending manual reconciliation. */
  constructor() {
    super(
      "A previous request with this Idempotency-Key failed in an indeterminate state and cannot be safely retried automatically. Contact support"
    );
    this.name = "IdempotencyIndeterminateError";
  }
}

/** Thrown by fn() instead of a plain error when it fails after an irreversible external call may have already gone out with no compensating reversal — signals withIdempotencyKey to leave the key row 'failed_indeterminate' instead of deleting it, so a retry can't re-execute that call. */
export class IndeterminateFailureError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "IndeterminateFailureError";
  }
}

/** Hashes the parts of a request that determine whether a repeated key is a legitimate retry (identical inputs) or reuse against a different request. */
export function hashRequest(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Runs `fn` under an idempotency key: first call executes and caches the result as 'completed'; a repeat with the same key+requestHash returns the cached result (or 409s if still 'in_progress'); a repeat with a different requestHash 409s as key reuse; on a plain throw the key is deleted so the client can retry clean, but on IndeterminateFailureError it's left 'failed_indeterminate' and permanently rejected. Race-safe because concurrent inserts of the same key collide on the primary key (23505) and the loser falls into the read path instead of double-running `fn`. */
export async function withIdempotencyKey<T extends { statusCode: number; body: unknown }>(
  key: string,
  requestHash: string,
  fn: () => Promise<T>
): Promise<T> {
  const expiresAt = new Date(Date.now() + KEY_TTL_HOURS * 60 * 60 * 1000);

  let inserted = true;
  try {
    await db.insert(idempotencyKeys).values({ key, requestHash, status: "in_progress", expiresAt });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    inserted = false;
  }

  if (!inserted) {
    const [existing] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    if (!existing || existing.requestHash !== requestHash) {
      throw new IdempotencyKeyReuseError();
    }
    if (existing.status === "in_progress") {
      throw new IdempotencyInProgressError();
    }
    if (existing.status === "failed_indeterminate") {
      throw new IdempotencyIndeterminateError();
    }
    return existing.response as T;
  }

  try {
    const result = await fn();
    await db
      .update(idempotencyKeys)
      .set({ status: "completed", response: result })
      .where(eq(idempotencyKeys.key, key));
    return result;
  } catch (err) {
    if (err instanceof IndeterminateFailureError) {
      await db.update(idempotencyKeys).set({ status: "failed_indeterminate" }).where(eq(idempotencyKeys.key, key));
      throw err.cause;
    }
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    throw err;
  }
}
