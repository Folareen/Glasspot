import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { idempotencyKeys } from "@glasspot/db";
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
      "A previous request with this Idempotency-Key failed in an indeterminate state and cannot be safely retried automatically — contact support"
    );
    this.name = "IdempotencyIndeterminateError";
  }
}

/**
 * fn() should throw this (wrapping the real cause) instead of a plain
 * error when it fails AFTER an irreversible external call may have gone
 * out (e.g. a Nomba transfer request that could have been accepted
 * server-side even though the response errored) and has no compensating
 * reversal of its own. Signals withIdempotencyKey to leave the key row in
 * 'failed_indeterminate' rather than deleting it — deleting would let a
 * client retry re-execute the external call from scratch.
 */
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

/**
 * Wraps a mutating money endpoint's handler logic in the shared
 * idempotency_keys table (see docs/system-rules.md: "idempotency keys on
 * every mutating money endpoint... server stores result against it,
 * retries return the cached result instead of re-executing").
 *
 * First call for `key`: inserts an 'in_progress' row, runs `fn`, stores
 * its result as 'completed', returns it.
 * Repeat call, same key + same requestHash, status 'completed': returns
 * the cached { statusCode, body } WITHOUT calling `fn` again.
 * Repeat call, same key + same requestHash, status 'in_progress': throws
 * IdempotencyInProgressError (409) — no polling, per system-rules.md
 * discussion; the client's own retry will succeed once the first
 * request's row flips to 'completed'.
 * Repeat call, same key + DIFFERENT requestHash: throws
 * IdempotencyKeyReuseError (409) — reusing a key across different
 * requests is a client bug, not a retry, and must not silently replay
 * the wrong cached response.
 *
 * The insert of the 'in_progress' row is the race-safety mechanism: two
 * concurrent requests with the same key race on inserting the same
 * primary key, and only one wins (23505 unique violation) — the loser
 * re-reads the now-existing row and falls into the in_progress/completed
 * handling above instead of double-executing `fn`.
 *
 * If `fn` throws a plain error (a legitimate rejection like "pot has no
 * balance to pay out", or any failure it has already fully compensated
 * for itself — e.g. PotsService.postDisbursement's own internal
 * reversal-on-failure), the key row is DELETED rather than left
 * 'in_progress' forever — nothing outstanding remains, so the client must
 * be able to retry the same key from a clean slate.
 *
 * If `fn` throws an IndeterminateFailureError — a failure where an
 * external call may have already gone out with no compensating reversal —
 * the row is instead left 'failed_indeterminate' and a client retry with
 * the same key is permanently rejected via IdempotencyIndeterminateError,
 * since silently deleting it would risk re-executing that external call.
 */
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
