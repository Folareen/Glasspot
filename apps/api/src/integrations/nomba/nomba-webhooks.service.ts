import { eq } from "drizzle-orm";
import db, { providerEvents } from "@glasspot/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { ContributionsService } from "@/modules/pots/contributions.service";
import { PotsService } from "@/modules/pots/pots.service";
import { WebhookEvent, WebhookTransactionData } from "@/integrations/nomba/nomba.types";

/**
 * Business-logic dispatch for a verified, deduped Nomba webhook event —
 * called from the webhook route after NombaClient.handleWebhook has
 * already verified the signature and skipped a redelivered requestId (see
 * webhooks.ts). Persists to provider_events first (our OWN durable dedupe
 * + audit trail, independent of NombaClient's in-memory/Redis requestId
 * store — see provider-events.ts schema comment: insert first, then
 * process), then routes to the matching handler by event_type. All six
 * event_types (see NOMBA_WEBHOOK_EVENT_TYPES) share one payload envelope —
 * confirmed against developer.nomba.com/docs/api-basics/webhook.
 */
export const NombaWebhooksService = {
  /** Records the event and dispatches it to the matching handler. */
  async handle(event: WebhookEvent<WebhookTransactionData>, signatureValid: boolean): Promise<void> {
    const [existing] = await db.select().from(providerEvents).where(eq(providerEvents.eventId, event.requestId));
    if (existing?.processed) {
      return;
    }

    let eventRow: typeof providerEvents.$inferSelect;
    if (existing) {
      eventRow = existing;
    } else {
      try {
        [eventRow] = await db
          .insert(providerEvents)
          .values({
            provider: "nomba",
            eventId: event.requestId,
            eventType: event.event_type,
            payload: event as unknown,
            signatureValid,
          })
          .returning();
      } catch (err) {
        // A concurrent redelivery of the same event won the race to insert
        // between our select above and this insert — eventId's unique
        // constraint is the real dedup guarantee, this select-then-insert
        // is just the common path. Whichever call lost the race skips
        // dispatch entirely rather than double-processing; the winner's
        // insert (or the next redelivery, once processed=true lands) is
        // what actually runs the handler.
        if (isUniqueViolation(err)) {
          return;
        }
        throw err;
      }
    }

    switch (event.event_type) {
      case "payment_success":
        await ContributionsService.confirmFunding(event.data);
        break;
      case "payment_failed":
        // Funding attempt failed — the contribution simply stays 'pending'
        // (it can still be paid into again, or expires on its own). No
        // local state to change; recorded above for audit/visibility.
        break;
      case "payment_reversal":
        // Money we'd already credited to a pot got reversed back out —
        // unlike payment_failed, this can happen AFTER we've posted a
        // 'funded' contribution's ledger transaction, so it needs an
        // actual reversal, not a no-op.
        await ContributionsService.reverseFunding(event.data);
        break;
      case "payout_success":
        await resolveTransfer(event.data, "success");
        break;
      case "payout_failed":
      case "payout_refund":
        // payout_refund is the terminal state of a failed transfer once
        // Nomba auto-refunds it back to our account (see
        // transferToBankAccount's doc comment) — same local handling as
        // payout_failed: the transfer never reached its destination.
        await resolveTransfer(event.data, "failed");
        break;
    }

    await db
      .update(providerEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(providerEvents.id, eventRow.id));
  },
};

/** Resolves the payout/refund matching this transfer webhook's merchantTxRef (our own reference, echoed back — see WebhookTransactionData's doc comment). A no-op if merchantTxRef is missing, which should not happen for a payout event per Nomba's documented payload. */
async function resolveTransfer(data: WebhookTransactionData, outcome: "success" | "failed") {
  const merchantTxRef = data.transaction.merchantTxRef;
  if (!merchantTxRef) {
    return;
  }
  await PotsService.resolvePendingTransfer(merchantTxRef, outcome);
}
