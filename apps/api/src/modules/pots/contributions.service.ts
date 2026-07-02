import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { contributions, users, type Contribution } from "@glasspot/db";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { nomba } from "@/integrations/nomba";
import { NombaClient } from "@/integrations/nomba/nomba.client";
import { VirtualAccountPaymentData } from "@/integrations/nomba/nomba.types";
import { PotError } from "./pots.errors";
import { getViewablePotOrThrow } from "./pot-authorization";
import { ContributeInput } from "./pots.schema";

/**
 * A contribution is funded via a one-time Nomba virtual account (see
 * spec-mvp.md). create() only reserves the intent — it never posts a
 * ledger transaction, since we never trust a client-supplied amount for
 * execution (see docs/system-rules.md). The ledger only gets touched once
 * Nomba's virtual_account.funded webhook confirms real money landed — see
 * confirmFunding() below, called from the webhook route.
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

    // Our own idempotency key: a client retrying the exact same request
    // (e.g. input.idempotencyKey supplied) resolves to the same virtual
    // account instead of minting a fresh one each time.
    const virtualAccountRef = input.idempotencyKey ?? `contribution_${randomUUID()}`;

    const [existing] = await db
      .select()
      .from(contributions)
      .where(eq(contributions.virtualAccountRef, virtualAccountRef));
    if (existing) {
      return existing;
    }

    // Nomba's expectedAmount is in naira, our amounts are kobo (see
    // docs/system-rules.md) — divide down for the API call only, never
    // for anything stored or posted to the ledger.
    const virtualAccount = await nomba.createVirtualAccount({
      accountRef: virtualAccountRef,
      accountName: contributor.fullName,
      expectedAmount: Number(amountKobo) / 100,
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
      })
      .returning();

    return contribution;
  },

  /**
   * Called from the Nomba webhook route once a virtual account is funded.
   * Compares the amount actually received against expectedAmountKobo:
   * exact/overpaid posts the ledger transaction for the EXPECTED amount
   * (never the client/provider-reported amount — system-rules.md) and, on
   * overpaid, refunds the excess back to the sender. Underpaid posts
   * nothing and leaves the contribution flagged for follow-up rather than
   * silently dropping it. Safe to call twice for the same contribution —
   * a contribution already out of 'pending' is a no-op.
   */
  async confirmFunding(payment: VirtualAccountPaymentData): Promise<void> {
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

    if (contribution.status !== "pending") {
      return;
    }

    const verdict = NombaClient.evaluatePayment(
      payment.transaction.transactionAmount,
      Number(contribution.expectedAmountKobo) / 100
    );

    if (verdict === "underpaid") {
      await db
        .update(contributions)
        .set({ status: "underpaid" })
        .where(eq(contributions.id, contribution.id));
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

    if (verdict === "overpaid") {
      await nomba.refundOverpayment(payment, Number(contribution.expectedAmountKobo) / 100);
    }
  },
};
