import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import db, { contributions, contributionPayments, users, type Contribution } from "@/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { nomba } from "@/integrations/nomba";
import { WebhookTransactionData } from "@/integrations/nomba/nomba.types";
import { verifyAccountDetails } from "@/integrations/nomba/verify-account-details";
import { isUniqueViolation } from "@/lib/db-errors";
import { koboToNairaString, nairaStringToKobo } from "@/lib/money";
import { PotError } from "./pots.errors";
import { getViewablePotOrThrow } from "./pot-authorization";
import { ContributeInput } from "./pots.schema";
import { TargetBasedPayoutService } from "./target-based-payout.service";

/** How long a virtual account stays open for funding before ExpiryService sweeps it — see contributions.ts's expiresAt comment. */
export const CONTRIBUTION_EXPIRY_HOURS = 24;

// A contribution is funded via a one-time Nomba virtual account. create() only reserves the
// intent — it never posts a ledger transaction (never trust a client-supplied amount for
// execution). The ledger is only touched once accumulated payments reach expectedAmount, in
// confirmFunding() below. A virtual account accepts multiple transfers (a top-up toward an
// underpaid contribution) until fully funded or expiresAt passes (see ExpiryService).
export const ContributionsService = {
  /**
   * Validates the requested amount against the pot's min/max and open status, resolves+validates
   * a refund destination if the pot requires one, then issues a dedicated Nomba virtual account
   * for the contributor to pay into. userId is undefined for an anonymous contributor to a
   * public pot; such a contributor to a refundType='contributors' pot must still supply
   * refundAccountNumber/refundBankCode since there's no user profile to refund otherwise.
   */
  async create(potId: string, userId: string | undefined, input: ContributeInput): Promise<Contribution> {
    const pot = await getViewablePotOrThrow(potId, userId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to accept contributions", 409);
    }

    const amount = nairaStringToKobo(input.amount);
    if (amount < pot.minContribution) {
      throw new PotError(`Contribution must be at least ₦${koboToNairaString(pot.minContribution)}`, 400);
    }
    if (pot.maxContribution !== null && amount > pot.maxContribution) {
      throw new PotError(`Contribution must not exceed ₦${koboToNairaString(pot.maxContribution)}`, 400);
    }

    // A per-contributor refund account only means anything for a pot that
    // actually refunds each contributor individually (see contributions.ts
    // schema comment) — optional there (if omitted, PotsService's
    // postContributorsRefund falls back to whichever account each of this
    // contribution's funding payments actually came from — see that
    // function's comment), and rejected outright everywhere else so we
    // never silently store data that can't ever be used.
    let refundAccountNumber: string | undefined;
    let refundAccountName: string | undefined;
    let refundBank: string | undefined;

    if (pot.refundType === "contributors") {
      if (input.refundAccountNumber || input.refundBankCode) {
        if (!input.refundAccountNumber || !input.refundBankCode) {
          throw new PotError("refundAccountNumber and refundBankCode must both be set or both omitted", 400);
        }
        const resolved = await verifyAccountDetails(input.refundAccountNumber, input.refundBankCode);
        refundAccountNumber = input.refundAccountNumber;
        refundAccountName = resolved.accountName;
        refundBank = input.refundBankCode;
      }
    } else if (input.refundAccountNumber || input.refundBankCode) {
      throw new PotError("This pot does not use per-contributor refunds — omit refundAccountNumber/refundBankCode", 400);
    }

    // accountName for the virtual account: the logged-in contributor's own
    // name; for an anonymous contributor who DID supply a refund account,
    // the verified bank-account holder name already resolved above (see
    // docs/system-rules.md's validate-before-storing pattern); otherwise a
    // generic placeholder (an anonymous contributor who omitted the
    // refund account, or a refundType='admin' pot with no such field at
    // all — see postContributorsRefund's sender-account fallback for how
    // the omitted case still gets refunded correctly).
    let accountName: string;
    if (userId) {
      const [contributor] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!contributor) {
        throw new PotError("Contributor not found", 404);
      }
      accountName = contributor.fullName;
    } else {
      accountName = refundAccountName ?? "Anonymous contributor";
    }

    // Request-level idempotency is enforced at the HTTP layer (see
    // pots.controller.ts's withIdempotencyKey wrapping this call) — a
    // retried request with the same Idempotency-Key never reaches here a
    // second time, so virtualAccountRef only needs to be unique, not
    // derived from client input.
    const virtualAccountRef = `contribution_${randomUUID()}`;

    const expiresAt = new Date(Date.now() + CONTRIBUTION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Nomba's expectedAmount is in naira, our amounts are kobo (see
    // docs/system-rules.md) — convert via koboToNairaString for the API
    // call only, never for anything stored or posted to the ledger.
    // expiryDate format confirmed against developer.nomba.com:
    // "YYYY-MM-DD HH:mm:ss".
    const virtualAccount = await nomba.createVirtualAccount({
      accountRef: virtualAccountRef,
      accountName,
      expectedAmountNaira: Number(koboToNairaString(amount)),
      expiryDate: formatNombaExpiryDate(expiresAt),
    });

    const [contribution] = await db
      .insert(contributions)
      .values({
        potId,
        contributorUserId: userId,
        virtualAccountRef,
        virtualAccountNumber: virtualAccount.bankAccountNumber,
        expectedAmount: amount,
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
   * Called from the Nomba webhook on every payment_success event. Records the transfer as a
   * contribution_payments row (keyed by Nomba's transactionId, so a redelivered webhook can't
   * double-count it), then recomputes the accumulated total: >=expectedAmount posts the ledger
   * transaction for exactly expectedAmount (never the received total) and marks 'funded',
   * refunding any excess on this payment back to its sender; below that, marks/keeps 'underpaid'
   * so the virtual account stays open for a top-up. No-op once already funded/failed/reversed.
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

    // toFixed(2), never Math.round(transactionAmount * 100): that can round UP on a float
    // representation error, and this credits the ledger so it must never be inflated even by one
    // kobo (system-rules.md: never round money up). transactionAmount is untrusted external
    // input (unlike every other nairaStringToKobo call site), so if Nomba ever sends something
    // unparseable, throwing here would propagate uncaught to the webhook route and Nomba would
    // retry forever without the event ever being marked processed — log and bail instead, leaving
    // the contribution pending/underpaid for manual review.
    let amount: bigint;
    try {
      amount = nairaStringToKobo(payment.transaction.transactionAmount.toFixed(2));
    } catch (err) {
      console.error(
        `[contributions] payment_success for contribution ${contribution.id} (nombaTransactionId ${payment.transaction.transactionId}) has an unparseable transactionAmount: ${payment.transaction.transactionAmount} — skipping, needs manual review`,
        err
      );
      return;
    }

    try {
      await db.insert(contributionPayments).values({
        contributionId: contribution.id,
        nombaTransactionId: payment.transaction.transactionId,
        amount,
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
      .select({ total: sql<string>`coalesce(sum(${contributionPayments.amount}), 0)` })
      .from(contributionPayments)
      .where(eq(contributionPayments.contributionId, contribution.id));
    const receivedTotal = BigInt(total);

    if (receivedTotal < contribution.expectedAmount) {
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
        { accountId: platformFloat.id, direction: "debit", amount: contribution.expectedAmount },
        { accountId: potAccount.id, direction: "credit", amount: contribution.expectedAmount },
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

    // Fire a target_based payout immediately if this contribution just pushed the pot's balance
    // to its targetAmount, rather than waiting for the once-daily cron sweep
    // (TargetBasedPayoutService.fireDueTargetBasedPayouts) to notice — see that service's
    // checkAndFireForPot. No-op for every other payoutMode/pot state. Failure here (enqueue
    // error, pot already mid-payout) is logged and swallowed rather than thrown: the sweep still
    // catches it later, and a webhook handler failing must never leave the event unprocessed or
    // Nomba will redeliver it forever (see NombaWebhooksService.handle).
    try {
      await TargetBasedPayoutService.checkAndFireForPot(contribution.potId);
    } catch (err) {
      console.error(`checkAndFireForPot failed for pot ${contribution.potId} after contribution ${contribution.id}:`, err);
    }

    const excess = receivedTotal - contribution.expectedAmount;
    if (excess > 0n) {
      // refundOverpayment() computes the excess to send back as
      // transactionAmount - expectedAmount, so pass the portion of THIS
      // payment that was actually needed to reach expectedAmount —
      // amount minus however much of the total overshoot came from
      // this payment (capped at amount itself, since this payment
      // can't be blamed for more excess than its own size).
      const thisPaymentNeeded = amount - excess > 0n ? amount - excess : 0n;
      await nomba.refundOverpayment(payment, Number(koboToNairaString(thisPaymentNeeded)));
    }
  },

  /** Called on a payment_reversal event — reverses the original ledger transaction and marks the contribution 'reversed'. No-op if not currently 'funded' (nothing to reverse, or already reversed). */
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
