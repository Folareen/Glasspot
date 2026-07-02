import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import db, { contributions, contributionPayments, users, type Contribution } from "@glasspot/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { nomba } from "@/integrations/nomba";
import { WebhookTransactionData } from "@/integrations/nomba/nomba.types";
import { isUniqueViolation } from "@/lib/db-errors";
import { PotError } from "./pots.errors";
import { getViewablePotOrThrow } from "./pot-authorization";
import { ContributeInput } from "./pots.schema";

/** How long a virtual account stays open for funding before ExpiryService sweeps it — see contributions.ts's expiresAt comment. */
export const CONTRIBUTION_EXPIRY_HOURS = 24;

/**
 * A contribution is funded via a one-time Nomba virtual account (see
 * spec-mvp.md). create() only reserves the intent — it never posts a
 * ledger transaction, since we never trust a client-supplied amount for
 * execution (see docs/system-rules.md). The ledger only gets touched once
 * accumulated payments (see contribution-payments.ts) reach
 * expectedAmountKobo — see confirmFunding() below, called from the
 * webhook route. A virtual account accepts more than one transfer (a
 * top-up toward an underpaid contribution) until either fully funded or
 * expiresAt passes (see ExpiryService).
 */
export const ContributionsService = {
  /**
   * Validates the requested amount against the pot's min/max and open
   * status, resolves+validates a refund destination if the pot requires
   * one, then issues a dedicated Nomba virtual account for the contributor
   * to pay into. Returns the pending contribution row.
   */
  async create(potId: string, userId: string, input: ContributeInput): Promise<Contribution> {
    const pot = await getViewablePotOrThrow(potId, userId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to accept contributions", 409);
    }

    const amountKobo = BigInt(input.amountKobo);
    if (amountKobo < pot.minContributionKobo) {
      throw new PotError(`Contribution must be at least ${pot.minContributionKobo} kobo`, 400);
    }
    if (pot.maxContributionKobo !== null && amountKobo > pot.maxContributionKobo) {
      throw new PotError(`Contribution must not exceed ${pot.maxContributionKobo} kobo`, 400);
    }

    // A per-contributor refund account only means anything for a pot that
    // actually refunds each contributor individually (see contributions.ts
    // schema comment) — required there, and rejected outright everywhere
    // else so we never silently store data that can't ever be used.
    let refundAccountNumber: string | undefined;
    let refundAccountName: string | undefined;
    let refundBank: string | undefined;

    if (pot.refundType === "contributors") {
      if (!input.refundAccountNumber || !input.refundBankCode) {
        throw new PotError(
          "refundAccountNumber and refundBankCode are required for a pot with refundType='contributors'",
          400
        );
      }
      const resolved = await nomba.lookupBankAccount(input.refundAccountNumber, input.refundBankCode);
      refundAccountNumber = input.refundAccountNumber;
      refundAccountName = resolved.accountName;
      refundBank = input.refundBankCode;
    } else if (input.refundAccountNumber || input.refundBankCode) {
      throw new PotError("This pot does not use per-contributor refunds — omit refundAccountNumber/refundBankCode", 400);
    }

    const [contributor] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!contributor) {
      throw new PotError("Contributor not found", 404);
    }

    // Request-level idempotency is enforced at the HTTP layer (see
    // pots.controller.ts's withIdempotencyKey wrapping this call) — a
    // retried request with the same Idempotency-Key never reaches here a
    // second time, so virtualAccountRef only needs to be unique, not
    // derived from client input.
    const virtualAccountRef = `contribution_${randomUUID()}`;

    const expiresAt = new Date(Date.now() + CONTRIBUTION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Nomba's expectedAmount is in naira, our amounts are kobo (see
    // docs/system-rules.md) — divide down for the API call only, never
    // for anything stored or posted to the ledger. expiryDate format
    // confirmed against developer.nomba.com: "YYYY-MM-DD HH:mm:ss".
    const virtualAccount = await nomba.createVirtualAccount({
      accountRef: virtualAccountRef,
      accountName: contributor.fullName,
      expectedAmount: Number(amountKobo) / 100,
      expiryDate: formatNombaExpiryDate(expiresAt),
    });

    const [contribution] = await db
      .insert(contributions)
      .values({
        potId,
        contributorUserId: userId,
        virtualAccountRef,
        virtualAccountNumber: virtualAccount.bankAccountNumber,
        expectedAmountKobo: amountKobo,
        anonymous: input.anonymous ?? false,
        refundAccountNumber,
        refundAccountName,
        refundBank,
        expiresAt,
      })
      .returning();

    return contribution;
  },

  /**
   * Called from the Nomba webhook route on every payment_success event.
   * Records this specific transfer as a contribution_payments row (keyed
   * by Nomba's own transactionId, so a redelivered webhook for the SAME
   * transfer can't double-count it), then recomputes the accumulated
   * total across all payments for this contribution:
   *   - total >= expectedAmountKobo: posts the ledger transaction for
   *     exactly expectedAmountKobo (never the received total —
   *     system-rules.md), marks 'funded'. Any excess on THIS payment is
   *     refunded back to its own sender.
   *   - total < expectedAmountKobo: marks/keeps 'underpaid' — the virtual
   *     account stays open for a top-up, not a dead end (see
   *     ExpiryService for what happens if it never completes).
   * No-op once the contribution is already funded/failed/reversed — those
   * are terminal; only 'pending'/'underpaid' accept more payments.
   */
  async confirmFunding(payment: WebhookTransactionData): Promise<void> {
    if (!payment.transaction.aliasAccountNumber) {
      // Not actually a virtual-account funding payload (aliasAccountNumber
      // is only populated on payment_* events — see WebhookTransactionData's
      // doc comment). Nothing to match against.
      return;
    }

    const [contribution] = await db
      .select()
      .from(contributions)
      .where(eq(contributions.virtualAccountNumber, payment.transaction.aliasAccountNumber));

    if (!contribution) {
      // No matching contribution — surfaced via reconciliation as an
      // "orphan" line item rather than handled here (see
      // ReconciliationService), since we have nothing local to act on yet.
      return;
    }

    if (contribution.status !== "pending" && contribution.status !== "underpaid") {
      return;
    }

    if (!payment.customer?.accountNumber || !payment.customer.bankCode || !payment.customer.senderName) {
      // Can't record a payment without knowing who to refund it to if the
      // contribution ultimately expires unfunded (see ExpiryService) —
      // reject rather than silently accept an unrefundable payment.
      throw new Error("payment_success payload missing customer bank details");
    }

    const amountKobo = BigInt(Math.round(payment.transaction.transactionAmount * 100));

    try {
      await db.insert(contributionPayments).values({
        contributionId: contribution.id,
        nombaTransactionId: payment.transaction.transactionId,
        amountKobo,
        senderAccountNumber: payment.customer.accountNumber,
        senderBankCode: payment.customer.bankCode,
        senderName: payment.customer.senderName,
      });
    } catch (err) {
      // Unique violation on nomba_transaction_id — a redelivered webhook
      // for a transfer we've already recorded. Already accounted for in
      // the running total; nothing more to do.
      if (isUniqueViolation(err)) return;
      throw err;
    }

    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${contributionPayments.amountKobo}), 0)` })
      .from(contributionPayments)
      .where(eq(contributionPayments.contributionId, contribution.id));
    const receivedTotalKobo = BigInt(total);

    if (receivedTotalKobo < contribution.expectedAmountKobo) {
      await db.update(contributions).set({ status: "underpaid" }).where(eq(contributions.id, contribution.id));
      return;
    }

    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const potAccount = await AccountsService.getOrCreatePotAccount(contribution.potId);

    const transaction = await LedgerService.postTransaction({
      type: "contribution",
      reference: `contribution_${contribution.id}`,
      externalReference: payment.transaction.transactionId,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amountKobo: contribution.expectedAmountKobo },
        { accountId: potAccount.id, direction: "credit", amountKobo: contribution.expectedAmountKobo },
      ],
      metadata: {
        potId: contribution.potId,
        contributorUserId: contribution.contributorUserId,
        anonymous: contribution.anonymous,
        refundAccountNumber: contribution.refundAccountNumber,
        refundAccountName: contribution.refundAccountName,
        refundBank: contribution.refundBank,
      },
    });

    await db
      .update(contributions)
      .set({ status: "funded", transactionId: transaction.id, fundedAt: new Date() })
      .where(eq(contributions.id, contribution.id));

    const excessKobo = receivedTotalKobo - contribution.expectedAmountKobo;
    if (excessKobo > 0n) {
      // refundOverpayment() computes the excess to send back as
      // transactionAmount - expectedAmount, so pass the portion of THIS
      // payment that was actually needed to reach expectedAmountKobo —
      // amountKobo minus however much of the total overshoot came from
      // this payment (capped at amountKobo itself, since this payment
      // can't be blamed for more excess than its own size).
      const thisPaymentNeededKobo = amountKobo - excessKobo > 0n ? amountKobo - excessKobo : 0n;
      await nomba.refundOverpayment(payment, Number(thisPaymentNeededKobo) / 100);
    }
  },

  /**
   * Called from the Nomba webhook route on a payment_reversal event —
   * money already credited to a pot (a 'funded' contribution) was clawed
   * back out. Reverses the original ledger transaction and marks the
   * contribution 'reversed'. A no-op if the contribution isn't 'funded'
   * (nothing to reverse yet, or already reversed by a redelivered event —
   * see docs/system-rules.md's at-least-once delivery requirement).
   */
  async reverseFunding(payment: WebhookTransactionData): Promise<void> {
    if (!payment.transaction.aliasAccountNumber) {
      return;
    }

    const [contribution] = await db
      .select()
      .from(contributions)
      .where(eq(contributions.virtualAccountNumber, payment.transaction.aliasAccountNumber));

    if (!contribution || contribution.status !== "funded" || !contribution.transactionId) {
      return;
    }

    await LedgerService.reverseTransaction(contribution.transactionId, `contribution_${contribution.id}_reversal`);

    await db.update(contributions).set({ status: "reversed" }).where(eq(contributions.id, contribution.id));
  },
};

/** Formats a Date as Nomba's expected "YYYY-MM-DD HH:mm:ss" expiryDate string (UTC), confirmed against developer.nomba.com/nomba-api-reference/virtual-accounts/create-virtual-account. */
function formatNombaExpiryDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
