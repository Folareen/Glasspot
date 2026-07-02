import { eq } from "drizzle-orm";
import db, { providerEvents } from "@glasspot/db";
import { ContributionsService } from "@/modules/pots/contributions.service";
import { PotsService } from "@/modules/pots/pots.service";
import { WebhookEvent, VirtualAccountPaymentData } from "@/integrations/nomba/nomba.types";

/**
 * Funding events have shipped under two different event_type strings in
 * this codebase's own reference material ("virtual_account.funded" per
 * nomba.client.ts's top-of-file doc, "payment_success" per its usage
 * example lower in the same file) — accept either rather than guess which
 * one Nomba actually sends, so a real webhook isn't silently dropped over
 * a naming mismatch that hasn't been confirmed against Nomba's live docs.
 */
const FUNDING_EVENT_TYPES = new Set(["virtual_account.funded", "payment_success"]);
const TRANSFER_SUCCESS_EVENT = "transfer.success";
const TRANSFER_FAILED_EVENT = "transfer.failed";

/**
 * Business-logic dispatch for a verified, deduped Nomba webhook event —
 * called from the webhook route after NombaClient.handleWebhook has
 * already verified the signature and skipped a redelivered requestId (see
 * webhooks.ts). Persists to provider_events first (our OWN durable dedupe
 * + audit trail, independent of NombaClient's in-memory/Redis requestId
 * store — see provider-events.ts schema comment: insert first, then
 * process), then routes to the matching handler by event_type.
 */
export const NombaWebhooksService = {
  /** Records the event and dispatches it to the matching handler; unrecognized event_types are recorded but otherwise ignored. */
  async handle(event: WebhookEvent, signatureValid: boolean): Promise<void> {
    const [existing] = await db.select().from(providerEvents).where(eq(providerEvents.eventId, event.requestId));
    if (existing?.processed) {
      return;
    }

    const eventRow =
      existing ??
      (
        await db
          .insert(providerEvents)
          .values({
            provider: "nomba",
            eventId: event.requestId,
            eventType: event.event_type,
            payload: event as unknown,
            signatureValid,
          })
          .returning()
      )[0];

    if (FUNDING_EVENT_TYPES.has(event.event_type)) {
      await ContributionsService.confirmFunding(event.data as VirtualAccountPaymentData);
    } else if (event.event_type === TRANSFER_SUCCESS_EVENT) {
      await resolveTransfer(event, "success");
    } else if (event.event_type === TRANSFER_FAILED_EVENT) {
      await resolveTransfer(event, "failed");
    }
    // Any other event_type: recorded above for audit purposes, no
    // business-logic side effect defined for it in this build.

    await db
      .update(providerEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(providerEvents.id, eventRow.id));
  },
};

/** Extracts the merchantTxRef our own transfer call set (== transactions.reference) from a transfer webhook's payload and resolves the matching payout/refund. */
async function resolveTransfer(event: WebhookEvent, outcome: "success" | "failed") {
  const data = event.data as { merchantTxRef?: string; transaction?: { merchantTxRef?: string } };
  const merchantTxRef = data.merchantTxRef ?? data.transaction?.merchantTxRef;
  if (!merchantTxRef) {
    return;
  }
  await PotsService.resolvePendingTransfer(merchantTxRef, outcome);
}
