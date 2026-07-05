import { pgTable, uuid, text, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Log of every inbound webhook from a payment provider (Nomba). This is
 * the dedupe/idempotency layer for anything arriving from outside — insert
 * first, verify signature, then process (see docs comment order in the
 * reference material). eventId is the provider's own id and IS the
 * idempotency key: unique constraint means a redelivered webhook fails the
 * insert / conflicts, so the handler skips reprocessing instead of
 * re-applying the event.
 *
 * processed/processedAt track whether the business-logic side effect
 * (posting a transaction, etc.) actually ran — kept separate from the
 * insert itself since "we've seen this webhook" and "we've acted on it"
 * can legitimately be different instants (e.g. crash between insert and
 * processing, retried on next delivery of the same event).
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
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type NewProviderEvent = typeof providerEvents.$inferInsert;
