import { pgTable, uuid, text, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Log of every inbound webhook from Nomba — the dedupe/idempotency layer for inbound events
 * (insert first, verify signature, then process). eventId is the provider's own id and is the
 * idempotency key, unique so a redelivered webhook conflicts instead of reprocessing.
 * processed/processedAt are tracked separately from the insert since "seen" and "acted on" can
 * be different instants (e.g. a crash between insert and processing).
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
