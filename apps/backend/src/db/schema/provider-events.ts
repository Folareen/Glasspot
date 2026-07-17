import { pgTable, uuid, text, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Log of every inbound webhook from Nomba — the dedupe/idempotency layer for inbound events
 * (insert first, verify signature, then process). eventId is the provider's own id and is the
 * idempotency key, unique so a redelivered webhook conflicts instead of reprocessing.
 * processed/processedAt are tracked separately from the insert since "seen" and "acted on" can
 * be different instants (e.g. a crash between insert and processing). claimedAt is a separate,
 * narrower lock than processed: processed only ever guards the row-not-yet-inserted race (two
 * redeliveries racing to INSERT), not two redeliveries that both find an already-inserted,
 * not-yet-processed row and would otherwise both fall through to dispatch concurrently — claimedAt
 * is set atomically (UPDATE ... WHERE claimed_at IS NULL) right before dispatch so the second
 * concurrent caller sees 0 rows affected and skips instead of double-dispatching. Nulled back out
 * if dispatch throws, so a genuine failure still gets retried by the next redelivery rather than
 * wedged behind a stale claim forever.
 */
export const providerEvents = pgTable('provider_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  eventId: text('event_id').unique().notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  signatureValid: boolean('signature_valid').notNull(),
  processed: boolean('processed').notNull().default(false),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type NewProviderEvent = typeof providerEvents.$inferInsert;
