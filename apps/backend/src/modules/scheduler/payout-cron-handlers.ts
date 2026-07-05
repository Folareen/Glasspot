// src/modules/scheduler/payout-cron-handlers.ts
import { ExpiryService } from '@/modules/pots/expiry.service';
import { PayoutSchedulerService } from '@/modules/pots/payout-scheduler.service';
import { ReconciliationService } from '@/modules/ledger/reconciliation.service';
// import { TargetBasedPayoutService } from '@/modules/pots/target-based-payout.service';


export class PayoutCronHandlers {
/*
 Logic: targetDate <= now() OR targetAmountKobo <= pot.balance OR adminManualEnabled = true, 
 filtered on fired = false, then mark fired = true, firedAt = now() transactionally with the transfer enqueue 
 (so a crash between "fire" and "enqueue" can't double-pay or silently drop it — write the outbox row and flip fired 
 in the same DB transaction, enqueue after commit).
*/
  async checkTargetBasedPayouts() {
    // const result = await TargetBasedPayoutService.fireDueTargetBasedPayouts();
    // return { fired: result.fired, skipped: result.skipped };
  }

  async checkRecurringPayouts() {
    const recurring = await PayoutSchedulerService.fireDueRecurringPayouts();
    const scheduled = await PayoutSchedulerService.fireDueScheduledLegs();
    return { recurring, scheduled };
  }

  async sweepExpiredContributions() {
    const result = await ExpiryService.sweepExpiredContributions();
    return result;
  }

  async runReconciliation(hoursBack = 24) {
    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - hoursBack * 60 * 60 * 1000);
    const batch = await ReconciliationService.runForWindow(dateFrom, dateTo);
    return batch;
  }
}