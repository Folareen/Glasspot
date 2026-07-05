/**
 * One-off recurring/scheduled payout firing runner — invoke manually or
 * wire into a cron job later. No BullMQ/scheduler exists yet in this
 * build, so this script is the entry point until one does (same pattern
 * as run-reconciliation.ts / expire-contributions.ts).
 *
 * Usage: tsx --env-file=.env src/scripts/fire-payouts.ts
 */
import { PayoutSchedulerService } from "@/modules/pots/payout-scheduler.service";

const recurring = await PayoutSchedulerService.fireDueRecurringPayouts();
console.log(`Recurring payouts: ${recurring.fired} fired, ${recurring.skipped} skipped`);

const scheduled = await PayoutSchedulerService.fireDueScheduledLegs();
console.log(`Scheduled legs: ${scheduled.fired} fired, ${scheduled.skipped} skipped`);
