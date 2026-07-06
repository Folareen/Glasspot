import { pgTable, text, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';

/**
 * Dedupe layer for our own mutating API calls (not inbound webhooks — see provider-events.ts).
 * key is client-supplied and primary; a retry with the same key returns the cached `response`.
 * requestHash catches key reuse with a different payload (a client bug, rejected not replayed).
 * status='in_progress' blocks a concurrent duplicate from re-executing; 'failed_indeterminate'
 * means an external side effect (e.g. a Nomba transfer) may already have fired, so the row is
 * kept and a retry is rejected rather than risking a second call.
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
