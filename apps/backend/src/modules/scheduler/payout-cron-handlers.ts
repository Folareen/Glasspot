// src/modules/scheduler/payout-cron-handlers.ts
import { ExpiryService } from '@/modules/pots/expiry.service';
import { PayoutSchedulerService } from '@/modules/pots/payout-scheduler.service';
import { ReconciliationService } from '@/modules/ledger/reconciliation.service';
import { TargetBasedPayoutService } from '@/modules/pots/target-based-payout.service';


export class PayoutCronHandlers {
/*
 Logic: targetDate <= now() OR targetAmountKobo <= pot.balance OR adminManualEnabled = true, 
 filtered on fired = false, then mark fired = true, firedAt = now() transactionally with the transfer enqueue 
 (so a crash between "fire" and "enqueue" can't double-pay or silently drop it — write the outbox row and flip fired 
 in the same DB transaction, enqueue after commit).
*/
  async checkTargetBasedPayouts() {
    console.log('checkTargetBasedPayouts: firing due target-based payouts...');
    
    const result = await TargetBasedPayoutService.fireDueTargetBasedPayouts();
    
    console.log(`checkTargetBasedPayouts: fired ${result.fired}, skipped ${result.skipped}`);
    
    return { fired: result.fired, skipped: result.skipped };
  }

  async checkRecurringPayouts() {
    console.log('checkRecurringPayouts: firing due recurring payouts...');
    
    const recurring = await PayoutSchedulerService.fireDueRecurringPayouts();
    console.log(`checkRecurringPayouts: fired ${recurring.fired}, skipped ${recurring.skipped}`);
    
    const scheduled = await PayoutSchedulerService.fireDueScheduledLegs();
    console.log(`checkScheduledPayouts: fired ${scheduled.fired}, skipped ${scheduled.skipped}`);
    
    return { recurring, scheduled };
  }

  async sweepExpiredContributions() {
    console.log('sweepExpiredContributions: sweeping expired contributions...');
    
    const result = await ExpiryService.sweepExpiredContributions();
    console.log(`sweepExpiredContributions: expired contributions ${result.expiredContributions}, refunded payments ${result.refundedPayments}`);

    return result;
  }

  async runReconciliation(hoursBack = 24) {
    console.log(`runReconciliation: running reconciliation for the last ${hoursBack} hours...`);
    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - hoursBack * 60 * 60 * 1000);
    
    const batch = await ReconciliationService.runForWindow(dateFrom, dateTo);
    console.log(`runReconciliation: expected ${batch.expectedAmountKobo.toString()}, reportedAmountKobo ${batch.reportedAmountKobo?.toString()}, reference ${batch.batchReference}`);

    return batch;
  }
}