import { and, eq, isNull } from "drizzle-orm";
import db, { providerEvents } from "@/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { ContributionsService } from "@/modules/pots/contributions.service";
import { PotsService } from "@/modules/pots/pots.service";
import { WebhookEvent, WebhookTransactionData } from "@/integrations/nomba/nomba.types";

/** Business-logic dispatch for a verified, deduped Nomba webhook event: persists to provider_events first (our own durable dedupe + audit trail, independent of NombaClient's requestId store), then routes to the matching handler by event_type. */
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

    // Claims this row atomically before dispatch — the row-existence check above only guards the
    // race between two redeliveries both trying to INSERT; this guards the separate race where a
    // redelivery arrives while an earlier delivery of the SAME already-inserted row is still
    // mid-dispatch (processed is still false in both). Whichever caller's UPDATE actually flips
    // claimedAt wins; the loser sees 0 rows affected and returns without dispatching.
    const claimed = await db
      .update(providerEvents)
      .set({ claimedAt: new Date() })
      .where(and(eq(providerEvents.id, eventRow.id), isNull(providerEvents.claimedAt)))
      .returning();
    if (claimed.length === 0) {
      return;
    }

    try {
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
    } catch (err) {
      // Release the claim so the next redelivery (Nomba retries a webhook that didn't 2xx) can
      // actually retry dispatch, rather than finding claimedAt permanently set and skipping
      // forever — same "no silent failures" principle as the rest of this handler.
      await db.update(providerEvents).set({ claimedAt: null }).where(eq(providerEvents.id, eventRow.id));
      throw err;
    }

    await db
      .update(providerEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(providerEvents.id, eventRow.id));
  },
};

/** Resolves the payout/refund matching this transfer webhook's merchantTxRef (our own reference, echoed back); no-op if merchantTxRef is missing. */
async function resolveTransfer(data: WebhookTransactionData, outcome: "success" | "failed") {
  const merchantTxRef = data.transaction.merchantTxRef;
  if (!merchantTxRef) {
    return;
  }
  await PotsService.resolvePendingTransfer(merchantTxRef, outcome);
}
