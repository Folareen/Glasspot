import { pgTable, text, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';

/**
 * Dedupe layer for OUR OWN API calls (not inbound webhooks — see
 * provider-events.ts for that side). key is client-supplied (e.g. a hash
 * of user+action+nonce) and is the primary key: a retried request with the
 * same key returns the cached `response` instead of re-executing the
 * mutation. requestHash detects key reuse against a *different* payload,
 * which is a client bug, not a legitimate retry, and should be rejected
 * rather than silently replayed.
 *
 * status is 'in_progress' for the window between "we accepted this
 * request" and "we finished handling it" — a concurrent duplicate request
 * arriving in that window should not re-execute the mutation either
 * (checked at the service layer, not enforced by a DB constraint here).
 * 'failed_indeterminate' is for a failure where an external side effect
 * (e.g. a Nomba transfer call) may have already gone out before the
 * failure — the row is deliberately NOT deleted in that case (see
 * idempotency.service.ts), so a client retry is rejected rather than
 * silently re-executing a possibly-already-sent external call.
 */
export const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'completed', 'failed_indeterminate']);

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  requestHash: text('request_hash').notNull(),
  response: jsonb('response'),
  status: idempotencyStatusEnum('status').notNull().default('in_progress'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
