/**
 * One-off expiry sweep runner — invoke manually or wire into a cron job
 * later. No BullMQ/scheduler exists yet in this build, so this script is
 * the entry point until one does (same pattern as run-reconciliation.ts).
 *
 * Usage: tsx --env-file=.env src/scripts/expire-contributions.ts
 */
import { ExpiryService } from "@/modules/pots/expiry.service";

const result = await ExpiryService.sweepExpiredContributions();

console.log(
  `Expiry sweep: ${result.expiredContributions} contribution(s) expired, ${result.refundedPayments} payment(s) refunded`
);
