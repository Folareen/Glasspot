import { pgTable, uuid, text, bigint, boolean, timestamp } from 'drizzle-orm/pg-core';
import { pots } from './pots';

/**
 * Payout rule for a pot with payoutMode = 'scheduled' — a flat, unordered
 * set of one-shot payout entries, each with its own destination, amount,
 * and date. E.g. pay account A ₦50,000 on Monday, pay account B ₦30,000 on
 * Tuesday. Each entry fires independently on its own scheduledDate — no
 * sequence dependency between entries (unlike 'rotation', where leg 2
 * cannot fire before leg 1). The same destination can appear more than
 * once (e.g. paying the same vendor on two different dates); 'rotation'
 * expects one turn per recipient.
 *
 * scheduledPayoutConfigs: one row per pot (potId unique), just the parent.
 * scheduledPayoutEntries: the individual entries.
 *
 * Set once while the pot is 'draft' and immutable once the pot is 'open' —
 * see pots.ts status semantics.
 */
export const scheduledPayoutConfigs = pgTable('scheduled_payout_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  potId: uuid('pot_id')
    .notNull()
    .unique()
    .references(() => pots.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledPayoutEntries = pgTable('scheduled_payout_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduledConfigId: uuid('scheduled_config_id')
    .notNull()
    .references(() => scheduledPayoutConfigs.id, { onDelete: 'cascade' }),
  destinationAccount: text('destination_account').notNull(),
  destinationBank: text('destination_bank').notNull(),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  scheduledDate: timestamp('scheduled_date', { withTimezone: true }).notNull(),
  fired: boolean('fired').notNull().default(false),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduledPayoutConfig = typeof scheduledPayoutConfigs.$inferSelect;
export type NewScheduledPayoutConfig = typeof scheduledPayoutConfigs.$inferInsert;
export type ScheduledPayoutEntry = typeof scheduledPayoutEntries.$inferSelect;
export type NewScheduledPayoutEntry = typeof scheduledPayoutEntries.$inferInsert;
