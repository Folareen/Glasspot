/**
 * One-off reconciliation runner — invoke manually or wire into a cron job
 * later (see docs/system-rules.md: "run a reconciliation job... every few
 * minutes for pending, daily for full sweep"). No BullMQ/scheduler exists
 * yet in this build, so this script is the entry point until one does.
 *
 * Usage: tsx --env-file=.env src/scripts/run-reconciliation.ts [hoursBack]
 * Defaults to the last 24 hours if hoursBack is omitted.
 */
import { ReconciliationService } from "@/modules/ledger/reconciliation.service";

const hoursBack = Number(process.argv[2]) || 24;
const dateTo = new Date();
const dateFrom = new Date(dateTo.getTime() - hoursBack * 60 * 60 * 1000);

const batch = await ReconciliationService.runForWindow(dateFrom, dateTo);

console.log(
  `Reconciliation batch ${batch.id} [${batch.periodStart.toISOString()} - ${batch.periodEnd.toISOString()}]: ` +
    `status=${batch.status} expected=${batch.expectedAmountKobo} reported=${batch.reportedAmountKobo}`
);

process.exit(batch.status === "matched" ? 0 : 1);
