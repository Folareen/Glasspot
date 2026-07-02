import { randomUUID } from "node:crypto";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { PotError } from "./pots.errors";
import { getViewablePotOrThrow } from "./pot-authorization";
import { ContributeInput } from "./pots.schema";

/**
 * A contribution IS the funding event in this build (see spec-mvp.md: one
 * virtual account generated per contribution — there is no persistent,
 * pre-funded user wallet concept yet). Posting therefore mints the
 * contributed amount directly from platform_float straight into the pot's
 * account, the same "money in" shape the reference material uses for a
 * Nomba virtual-account webhook — this stands in for that webhook until
 * real Nomba funding wiring lands. No user_wallet leg exists in this flow.
 */
export const ContributionsService = {
  /** Validates the contribution amount against the pot's min/max and open status, then posts it as a ledger transaction (platform_float -> pot account) keyed by input.idempotencyKey. */
  async create(potId: string, userId: string, input: ContributeInput) {
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

    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const potAccount = await AccountsService.getOrCreatePotAccount(potId);

    const transaction = await LedgerService.postTransaction({
      type: "contribution",
      reference: input.idempotencyKey ?? `contribution_${randomUUID()}`,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amountKobo },
        { accountId: potAccount.id, direction: "credit", amountKobo },
      ],
      metadata: {
        potId,
        contributorUserId: userId,
        anonymous: input.anonymous ?? false,
        refundDestination: input.refundDestination,
      },
    });

    return transaction;
  },
};
