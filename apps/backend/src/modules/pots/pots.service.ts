import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import db, {
  pots,
  potMembers,
  users,
  transactions,
  contributions,
  contributionPayments,
  targetBasedPayoutConfigs,
  manualPayoutConfigs,
  recurringPayoutConfigs,
  scheduledPayoutConfigs,
  scheduledPayoutLegs,
  type Pot,
  type Transaction,
} from "@/db";
import { PotError } from "./pots.errors";
import { assertIsAdmin, getPotOrThrow } from "./pot-authorization";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { nomba } from "@/integrations/nomba";
import { verifyAccountDetails } from "@/integrations/nomba/verify-account-details";
import {
  CreatePotInput,
  UpdatePotInput,
  manualPayoutConfigSchema,
  recurringPayoutConfigSchema,
  scheduledPayoutConfigSchema,
  targetBasedPayoutConfigSchema,
} from "./pots.schema";
import { TransferQueueService } from "../scheduler/transfer-queue.service";
import { DisbursementOnSuccess, DisbursementJobData } from "../scheduler/disbursement-job.types";

// A self-contained payoutMode + matching payoutConfig pair, as a real
// discriminated union (not derived via Pick<CreatePotInput, ...> — that
// collapses z.infer's union in a way that loses the payoutMode <->
// payoutConfig correlation switch (input.payoutMode) below relies on).
// This is what insertPayoutConfig actually needs, regardless of whether
// it originated from a full create payload or was assembled from a
// partial update payload in PotsService.update. CreatePotInput already
// has this shape (its discriminated union guarantees the pairing);
// update() must build one explicitly since updatePotSchema is a flat,
// permissive object where payoutConfig's shape is NOT guaranteed to
// match payoutMode by the wire schema alone (see pots.schema.ts's
// updatePotSchema comment for why that union was deliberately dropped) —
// validated by validatePayoutModeConfig below.
type PayoutModeConfigPair =
  | { payoutMode: "target_based"; payoutConfig: z.infer<typeof targetBasedPayoutConfigSchema> }
  | { payoutMode: "manual"; payoutConfig: z.infer<typeof manualPayoutConfigSchema> }
  | { payoutMode: "recurring"; payoutConfig: z.infer<typeof recurringPayoutConfigSchema> }
  | { payoutMode: "scheduled"; payoutConfig: z.infer<typeof scheduledPayoutConfigSchema> };

/** Generates a random URL-safe slug for a pot's share link. */
function generateShareSlug(): string {
  return randomBytes(8).toString("base64url");
}

/**
 * pots.schema.ts's z.coerce.date() fields (targetDate, nextRunAt,
 * scheduledDate) are typed as `Date` after z.infer, but nothing in this
 * request pipeline actually calls Zod's .parse()/coerce logic — Fastify
 * validates request.body against the compiled JSON Schema via AJV only
 * (see pots.schema.ts's koboAmount comment for the same root cause). A
 * JSON Schema date-time field validates a raw ISO string, so request.body's
 * date fields are still plain strings at
 * runtime despite what the type claims. Drizzle's timestamp columns need
 * a real Date (they call .toISOString() on the value), so every date
 * field from request.body must be explicitly re-wrapped here before it
 * reaches an insert/update call.
 */
function toDate(value: Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Inserts the one payout config row matching input.payoutMode into its
 * mode-specific table. Only ever one of these four runs per call. Callers
 * must guarantee payoutConfig already matches payoutMode's shape —
 * PotsService.create gets that for free from createPotSchema's
 * discriminated union; PotsService.update calls validatePayoutModeConfig
 * first since updatePotSchema does not guarantee it (see that schema's
 * comment for why).
 *
 * Every destination account/bank pair is resolved via verifyAccountDetails()
 * (Nomba name-enquiry) before it's written — never trust a client-supplied
 * destination without confirming it resolves to a real account (see
 * docs/system-rules.md). Throws AccountVerificationError (400) if Nomba
 * can't resolve a destination, before any row is inserted.
 */
async function insertPayoutConfig(potId: string, input: PayoutModeConfigPair) {
  switch (input.payoutMode) {
    case "target_based": {
      const c = input.payoutConfig;
      const { accountName } = await verifyAccountDetails(c.destinationAccount, c.destinationBank);
      await db.insert(targetBasedPayoutConfigs).values({
        potId,
        destinationAccount: c.destinationAccount,
        destinationBank: c.destinationBank,
        destinationAccountName: accountName,
        targetDate: c.targetDate !== undefined ? toDate(c.targetDate) : undefined,
        targetAmount: c.targetAmount !== undefined ? BigInt(c.targetAmount) : undefined,
      });
      return;
    }
    case "manual": {
      const c = input.payoutConfig;
      if (c.destinationAccount === undefined || c.destinationBank === undefined) {
        // No destination set: fully open, picked at trigger time each
        // time — see PotsService.triggerPayout. No config row needed.
        return;
      }
      const { accountName } = await verifyAccountDetails(c.destinationAccount, c.destinationBank);
      await db.insert(manualPayoutConfigs).values({
        potId,
        destinationAccount: c.destinationAccount,
        destinationBank: c.destinationBank,
        destinationAccountName: accountName,
      });
      return;
    }
    case "recurring": {
      const c = input.payoutConfig;
      const { accountName } = await verifyAccountDetails(c.destinationAccount, c.destinationBank);
      await db.insert(recurringPayoutConfigs).values({
        potId,
        destinationAccount: c.destinationAccount,
        destinationBank: c.destinationBank,
        destinationAccountName: accountName,
        amount: BigInt(c.amount),
        intervalDays: c.intervalDays,
        nextRunAt: toDate(c.nextRunAt),
      });
      return;
    }
    case "scheduled": {
      const c = input.payoutConfig;
      const legsWithNames = await Promise.all(
        c.legs.map(async (leg) => ({
          ...leg,
          accountName: (await verifyAccountDetails(leg.destinationAccount, leg.destinationBank)).accountName,
        }))
      );
      const [scheduledConfig] = await db
        .insert(scheduledPayoutConfigs)
        .values({ potId, ordered: c.ordered ?? true })
        .returning();
      await db.insert(scheduledPayoutLegs).values(
        legsWithNames.map((leg) => ({
          scheduledConfigId: scheduledConfig.id,
          sequenceOrder: leg.sequenceOrder,
          destinationAccount: leg.destinationAccount,
          destinationBank: leg.destinationBank,
          destinationAccountName: leg.accountName,
          amount: BigInt(leg.amount),
          scheduledDate: toDate(leg.scheduledDate),
        }))
      );
      return;
    }
  }
}

/**
 * Confirms a { payoutMode, payoutConfig } pair pulled from an
 * UpdatePotInput actually correspond to each other, and narrows it into a
 * real PayoutModeConfigPair. updatePotSchema's wire validation only
 * confirms payoutConfig matches ONE of the 4 possible shapes — not
 * necessarily the one matching payoutMode (see that schema's comment for
 * why the two fields can't be tied together at the wire-schema level).
 *
 * payoutMode itself is already known (not being inferred here), so this
 * re-validates payoutConfig against that ONE specific mode's own Zod
 * schema via safeParse — much simpler and more correct than trying to
 * structurally distinguish all 4 shapes from each other, which isn't
 * reliable in general (a target_based config with no optional fields set
 * would otherwise be indistinguishable from another mode's empty shape).
 */
function validatePayoutModeConfig(
  payoutMode: CreatePotInput["payoutMode"],
  payoutConfig: NonNullable<UpdatePotInput["payoutConfig"]>
): PayoutModeConfigPair {
  switch (payoutMode) {
    case "target_based": {
      const result = targetBasedPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(`payoutConfig does not match payoutMode 'target_based': ${result.error.message}`, 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
    case "manual": {
      const result = manualPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(`payoutConfig does not match payoutMode 'manual': ${result.error.message}`, 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
    case "recurring": {
      const result = recurringPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(`payoutConfig does not match payoutMode 'recurring': ${result.error.message}`, 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
    case "scheduled": {
      const result = scheduledPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(`payoutConfig does not match payoutMode 'scheduled': ${result.error.message}`, 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
  }
}

/** Deletes whichever payout config row exists for this pot, regardless of mode — used before a draft-pot payoutMode change re-inserts the new one. */
async function deleteExistingPayoutConfig(potId: string, payoutMode: Pot["payoutMode"]) {
  switch (payoutMode) {
    case "target_based":
      await db.delete(targetBasedPayoutConfigs).where(eq(targetBasedPayoutConfigs.potId, potId));
      return;
    case "manual":
      // A no-op delete if this pot's manual config never had a destination
      // set (no row was ever inserted) — see insertPayoutConfig's manual case.
      await db.delete(manualPayoutConfigs).where(eq(manualPayoutConfigs.potId, potId));
      return;
    case "recurring":
      await db.delete(recurringPayoutConfigs).where(eq(recurringPayoutConfigs.potId, potId));
      return;
    case "scheduled": {
      // scheduled_payout_legs cascades on scheduled_payout_configs delete.
      await db.delete(scheduledPayoutConfigs).where(eq(scheduledPayoutConfigs.potId, potId));
      return;
    }
  }
}

export const PotsService = {
  /** Current ledger balance for a pot, in kobo — 0n for a pot that hasn't received any completed contributions yet (see AccountsService.getOrCreatePotAccount/LedgerService.getBalance). */
  async getBalance(potId: string): Promise<bigint> {
    const potAccount = await AccountsService.getOrCreatePotAccount(potId);
    return LedgerService.getBalance(potAccount.id);
  },

  /** Creates a pot in 'draft' status, inserts its mode-specific payout config, and adds creatorId as its first admin member. */
  async create(creatorId: string, input: CreatePotInput) {
    const [pot] = await db
      .insert(pots)
      .values({
        creatorId,
        title: input.title,
        description: input.description,
        potType: input.potType,
        payoutMode: input.payoutMode,
        refundType: input.refundType,
        shareSlug: generateShareSlug(),
        minContribution:
          input.minContribution !== undefined ? BigInt(input.minContribution) : undefined,
        maxContribution:
          input.maxContribution !== undefined ? BigInt(input.maxContribution) : undefined,
        goalAmount:
          input.goalAmount !== undefined ? BigInt(input.goalAmount) : undefined,
      })
      .returning();

    await insertPayoutConfig(pot.id, input);

    // Creator is inserted as a plain admin row — no special 'creator'
    // privilege exists. See pot-members.ts schema comment.
    await db.insert(potMembers).values({
      potId: pot.id,
      userId: creatorId,
      role: "admin",
    });

    return pot;
  },

  /** Returns all public pots plus, if userId is given, the private pots that user belongs to. */
  async list(userId: string | undefined) {
    // Public pots are visible to everyone. Private pots only show up for
    // an authenticated member — filtered in application code rather than
    // a single SQL query since "member of" requires a join per-pot type.
    const allPublic = await db.select().from(pots).where(eq(pots.potType, "public"));

    if (!userId) {
      return allPublic;
    }

    const myMemberships = await db
      .select({ potId: potMembers.potId })
      .from(potMembers)
      .where(eq(potMembers.userId, userId));
    const myPotIds = new Set(myMemberships.map((m) => m.potId));

    const privatePotsIAmIn =
      myPotIds.size === 0
        ? []
        : (await db.select().from(pots).where(eq(pots.potType, "private"))).filter((p) =>
            myPotIds.has(p.id)
          );

    return [...allPublic, ...privatePotsIAmIn];
  },

  /** Admin-only. Draft-only — payoutMode/refundType/config are immutable once a pot is 'open' (see pots.ts status semantics). */
  async update(potId: string, userId: string, input: UpdatePotInput) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "draft") {
      throw new PotError("Only a draft pot can be edited", 409);
    }

    // payoutConfig can arrive without payoutMode (client is only updating
    // config for the pot's CURRENT mode, not switching modes) — in that
    // case the effective mode to validate/insert against is the pot's
    // existing payoutMode, not input.payoutMode (which would be undefined).
    if (input.payoutConfig !== undefined) {
      const effectiveMode = input.payoutMode ?? pot.payoutMode;
      const pair = validatePayoutModeConfig(effectiveMode, input.payoutConfig);
      await deleteExistingPayoutConfig(potId, pot.payoutMode);
      await insertPayoutConfig(potId, pair);
      if (pair.payoutMode !== pot.payoutMode) {
        await db.update(pots).set({ payoutMode: pair.payoutMode }).where(eq(pots.id, potId));
      }
    } else if (input.payoutMode !== undefined && input.payoutMode !== pot.payoutMode) {
      // payoutMode changed but no payoutConfig was sent — the new mode has
      // no config to insert, which would leave the pot in an invalid state
      // (a payoutMode with no matching config row). Reject rather than
      // silently leaving it broken.
      throw new PotError("payoutConfig is required when changing payoutMode", 400);
    }

    const { title, description, potType, refundType, minContribution, maxContribution, goalAmount } = input;
    const [updated] = await db
      .update(pots)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(potType !== undefined && { potType }),
        ...(refundType !== undefined && { refundType }),
        ...(minContribution !== undefined && { minContribution: BigInt(minContribution) }),
        ...(maxContribution !== undefined && { maxContribution: BigInt(maxContribution) }),
        ...(goalAmount !== undefined && { goalAmount: BigInt(goalAmount) }),
        updatedAt: new Date(),
      })
      .where(eq(pots.id, potId))
      .returning();

    return updated;
  },

  /** Admin-only. draft -> open, one-way. payoutMode/refundType/config become immutable from this point on. */
  async activate(potId: string, userId: string) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "draft") {
      throw new PotError("Pot is not in draft status", 409);
    }

    const [updated] = await db
      .update(pots)
      .set({ status: "open", activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(pots.id, potId))
      .returning();

    return updated;
  },

  /** Admin-only. open -> closed, one-way, terminal. Only reachable once the pot's ledger balance is zero AND no payout/refund is still in flight (see pots.ts status semantics). */
  async close(potId: string, userId: string) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Only an open pot can be closed", 409);
    }

    if (pot.pendingOperation !== null) {
      throw new PotError("A payout or refund is still in flight for this pot — wait for it to resolve before closing", 409);
    }

    const potAccount = await AccountsService.getOrCreatePotAccount(potId);
    const balance = await LedgerService.getBalance(potAccount.id);
    if (balance !== 0n) {
      throw new PotError("Pot balance must be zero before it can be closed", 409);
    }

    // pendingOperation IS NULL in the WHERE clause, not just the check
    // above — a payout/refund can claim the lock between that check and
    // this UPDATE, and a reversal landing on a closed pot has no recovery
    // path (see backend-audit.md finding #1).
    const [updated] = await db
      .update(pots)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(pots.id, potId), isNull(pots.pendingOperation)))
      .returning();

    if (!updated) {
      throw new PotError("A payout or refund is still in flight for this pot — wait for it to resolve before closing", 409);
    }

    return updated;
  },

  /**
   * Manual payout trigger — only applicable to payoutMode='manual'.
   * target_based/recurring/scheduled pots have no manual trigger at all;
   * they fire exclusively via their own cron sweeps (see
   * TargetBasedPayoutService/PayoutSchedulerService) and rejecting them
   * here (see this method's bottom) is deliberate, not a gap.
   *
   * Validates authorization + pot/mode eligibility, then posts the
   * internal leg (debit pot_account, credit platform_float) and calls
   * Nomba to disburse to the destination — see postDisbursement() for the
   * full in-flight-lock + transfer-call shape.
   *
   * destination (the parameter) is only read when the pot has no fixed
   * destination on file (manual_payout_configs) — see the branch below
   * and pots.schema.ts's triggerPayoutSchema comment. A destination passed
   * alongside a pot that DOES have one fixed is ignored, not merged in, so
   * there is exactly one source of truth once a default is set.
   *
   * amount is optional — omit it for the original full-balance
   * behavior, or set it to disburse only PART of the pot's current
   * balance, leaving the rest in the pot for a later trigger. Must be
   * >0 and <=balance; re-checked against a freshly-read balance right
   * before claiming the lock in postFixedAmountDisbursement's caller here,
   * same re-read-after-lock-risk pattern as postDisbursement.
   */
  async triggerPayout(
    potId: string,
    userId: string,
    destination?: { destinationAccount: string; destinationBank: string },
    amount?: bigint
  ) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to trigger a payout", 409);
    }

    if (pot.payoutMode === "manual") {
      // manual mode fires repeatedly over the pot's lifetime. If the pot
      // was configured with a fixed default destination (manual_payout_configs),
      // that wins and the caller's destination (if any) is ignored — a
      // group that pre-agreed on a destination shouldn't have it silently
      // overridden by whichever admin happens to trigger payout. Only a
      // pot with no fixed destination requires the caller to supply one,
      // per-trigger — see this method's top comment.
      const [config] = await db
        .select()
        .from(manualPayoutConfigs)
        .where(eq(manualPayoutConfigs.potId, potId))
        .limit(1);

      const resolvedDestination =
        config?.destinationAccount && config.destinationBank
          ? { destinationAccount: config.destinationAccount, destinationBank: config.destinationBank }
          : destination;

      if (!resolvedDestination?.destinationAccount || !resolvedDestination.destinationBank) {
        throw new PotError(
          "destinationAccount and destinationBank are required to trigger a manual payout for a pot with no fixed destination",
          400
        );
      }

      // Only the caller-supplied branch needs re-verifying here — a fixed
      // config destination was already verified via verifyAccountDetails()
      // at save time (see insertPayoutConfig). Reject immediately rather
      // than letting a bad account number sit in the transfer queue until
      // the worker's own lookupBankAccount call fails it later.
      if (!config?.destinationAccount) {
        await verifyAccountDetails(resolvedDestination.destinationAccount, resolvedDestination.destinationBank);
      }

      if (amount !== undefined) {
        const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
        const balance = await LedgerService.getBalance(potAccount.id);
        if (amount <= 0n) {
          throw new PotError("amount must be greater than zero", 400);
        }
        if (amount > balance) {
          throw new PotError(`amount (${amount}) exceeds the pot's current balance (${balance})`, 409);
        }
        return postFixedAmountDisbursement(pot, "payout", amount, resolvedDestination);
      }

      return postDisbursement(pot, "payout", resolvedDestination);
    }

    throw new PotError(
      `Manual payout trigger is not applicable to payoutMode '${pot.payoutMode}'`,
      400
    );
  },

  /**
 * Manual refund trigger. refundType='admin' hands off a single-destination
 * disbursement to the triggering admin's own defaultRefundAccount/
 * defaultRefundBank on file (spec-mvp.md: refunds "to whoever triggers
 * it"), set via PATCH /auth/me/refund-profile. refundType='contributors'
 * fans out to every contributor pro-rata instead — see
 * postContributorsRefund().
 *
 * Returns void, not Transaction[] — no Transaction exists yet at the
 * point this returns, for either branch. Both now only ENQUEUE the
 * disbursement(s); the actual ledger posting + Nomba call happen later,
 * in the worker, once each job is processed (see
 * postFixedAmountDisbursement/postContributorsRefund's own comments).
 * The caller (refund route/controller) must respond "accepted for
 * processing," not with a completed transaction — see pots.route.ts.
 */
  async triggerRefund(potId: string, userId: string): Promise<void> {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to trigger a refund", 409);
    }

    if (pot.refundType === "contributors") {
      await postContributorsRefund(pot);
      return;
    }

    const [triggeringAdmin] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!triggeringAdmin?.defaultRefundAccount || !triggeringAdmin.defaultRefundBank) {
      throw new PotError(
        "Set a default refund bank account (PATCH /auth/me/refund-profile) before triggering an admin refund",
        409
      );
    }

    await postDisbursement(pot, "refund", {
      destinationAccount: triggeringAdmin.defaultRefundAccount,
      destinationBank: triggeringAdmin.defaultRefundBank,
    });
  },

  /**
   * Resolves a payout/refund transaction left 'processing' after a
   * PENDING_BILLING transfer call, once Nomba's payout_success or
   * payout_failed/payout_refund webhook reports the outcome — see
   * nomba-webhooks module, the only caller. Matched by
   * transaction.merchantTxRef == transactions.reference, which carries
   * potId in its metadata (see postDisbursement/postContributorsRefund). A
   * no-op if the transaction is already resolved (idempotent — see
   * docs/system-rules.md's at-least-once delivery requirement) or unknown.
   *
   * Decrements pendingOperationLegCount rather than unconditionally
   * clearing pendingOperation — a fan-out refund (refundType='contributors')
   * has N independent in-flight legs, and the pot-level lock must only
   * release once every leg has resolved, not the first one (see
   * postContributorsRefund and pots.ts's pendingOperationLegCount comment).
   * A single-destination payout/admin-refund starts with legCount=1, so
   * this same decrement-to-zero logic clears it on its one resolution.
   */
  async resolvePendingTransfer(transactionReference: string, outcome: "success" | "failed"): Promise<void> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.reference, transactionReference));

    if (!transaction || transaction.status !== "processing") {
      return;
    }

    const potId = (transaction.metadata as { potId?: string } | null)?.potId;
    if (!potId) {
      return;
    }

    if (outcome === "success") {
      await LedgerService.markCompleted(transaction.id);
    } else {
      await LedgerService.reverseTransaction(transaction.id, `${transaction.reference}_reversal`);
    }

    await decrementPendingOperationLeg(potId);
  },
};

/**
 * Shared disbursement path for both payout and refund. Claims
 * pots.pendingOperation atomically first (locking out a second concurrent
 * trigger — see docs/system-rules.md's "two members approving in the same
 * instant must not both trigger the payout call"), then hands off to
 * postFixedAmountDisbursement with the pot's FULL current balance —
 * unlike PayoutSchedulerService, which passes a fixed amount for
 * recurring/scheduled, this path always disburses everything currently in
 * the pot (manual/target_based payout, admin refund).
 *
 * Returns void, not a Transaction — see postFixedAmountDisbursement's own
 * comment: no Transaction exists yet at the point this returns, since the
 * actual Nomba call and ledger posting now happen later, in the worker,
 * once the enqueued job is processed. Callers of THIS function (triggerPayout,
 * triggerRefund) must respond to their own callers as "accepted for
 * processing," not "completed" — see pots.route.ts's /:id/payout using
 * 202 with no body.
 */
async function postDisbursement(
  pot: Pot,
  kind: "payout" | "refund",
  destination: { destinationAccount: string; destinationBank: string },
  onSuccess?: DisbursementOnSuccess
): Promise<void> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);
  if (balance <= 0n) {
    throw new PotError(`Pot has no balance to ${kind}`, 409);
  }
  await postFixedAmountDisbursement(pot, kind, balance, destination, onSuccess);
}

// /**
//  * Core single-leg disbursement: claims pots.pendingOperation atomically
//  * (locking out a second concurrent trigger — see docs/system-rules.md's
//  * "two members approving in the same instant must not both trigger the
//  * payout call"), then looks up the destination, posts the internal ledger
//  * leg (debit pot_account, credit platform_float) for EXACTLY amount
//  * (not necessarily the pot's full balance — see postDisbursement, which
//  * passes the full balance for manual/target_based payout and admin
//  * refund, vs PayoutSchedulerService, which passes a FIXED amount for
//  * recurring/rotation), and calls Nomba's transfer API.
//  *
//  * On SUCCESS, resolves immediately: transaction -> completed,
//  * pendingOperation cleared. On PENDING_BILLING, leaves both the
//  * transaction and pendingOperation as-is — resolution happens later via
//  * the payout_success/payout_failed/payout_refund webhook (see
//  * nomba-webhooks module), never by blind-retrying (system-rules.md). On
//  * any failure (destination lookup, insufficient balance, or the transfer
//  * call itself rejected outright), releases the lock — reversing the
//  * internal ledger leg too if it was already posted, since we know for
//  * certain the transfer never started.
//  */
// export async function postFixedAmountDisbursement(
//   pot: Pot,
//   kind: "payout" | "refund",
//   amount: bigint,
//   destination: { destinationAccount: string; destinationBank: string }
// ): Promise<Transaction> {
//   // UPDATE ... WHERE pending_operation IS NULL is atomic in Postgres — of
//   // two concurrent triggers only one can ever match this row; the other's
//   // returning() comes back empty and is rejected before touching the
//   // ledger at all.
//   const reference = `${kind}_${pot.id}_${randomUUID()}`;
//   const claimed = await db
//     .update(pots)
//     .set({ pendingOperation: kind, pendingOperationLegCount: 1 })
//     .where(and(eq(pots.id, pot.id), isNull(pots.pendingOperation)))
//     .returning({ id: pots.id });

//   if (claimed.length === 0) {
//     throw new PotError(
//       "A payout or refund is already in flight for this pot — wait for it to resolve before triggering another",
//       409
//     );
//   }

//   let transaction: Transaction | undefined;

//   try {
//     const resolved = await nomba.lookupBankAccount(destination.destinationAccount, destination.destinationBank);

//     const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
//     const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
//     const balance = await LedgerService.getBalance(potAccount.id);

//     if (balance < amount) {
//       throw new PotError(`Pot balance is insufficient to ${kind} ${amount} kobo`, 409);
//     }

//     transaction = await LedgerService.postTransaction({
//       type: kind,
//       reference,
//       status: "processing",
//       entries: [
//         { accountId: potAccount.id, direction: "debit", amount },
//         { accountId: platformFloat.id, direction: "credit", amount },
//       ],
//       metadata: { potId: pot.id },
//     });

//     await db
//       .update(pots)
//       .set({ pendingOperationTransactionId: transaction.id })
//       .where(eq(pots.id, pot.id));

//     const transfer = await nomba.transferToBankAccount({
//       amount: Number(amount) / 100,
//       accountNumber: destination.destinationAccount,
//       accountName: resolved.accountName,
//       bankCode: destination.destinationBank,
//       merchantTxRef: reference,
//       senderName: "Glasspot",
//       narration: `Glasspot ${kind} for pot ${pot.id}`,
//     });

//     if (transfer.status === "SUCCESS") {
//       await LedgerService.markCompleted(transaction.id);
//       await clearPendingOperation(pot.id);
//     }
//     // PENDING_BILLING: transaction stays 'processing', pendingOperation
//     // stays set — resolved later by the payout_success/payout_failed/
//     // payout_refund webhook (see nomba-webhooks module). Never blind-retried.

//     return transaction;
//   } catch (err) {
//     if (transaction) {
//       await LedgerService.reverseTransaction(transaction.id, `${reference}_reversal`);
//     }
//     await clearPendingOperation(pot.id);
//     throw err;
//   }
// }

/**
 * Core single-leg disbursement: claims pots.pendingOperation atomically
 * (locking out a second concurrent trigger — see docs/system-rules.md's
 * "two members approving in the same instant must not both trigger the
 * payout call"), then hands the actual disbursement off to the
 * rate-limited `transfers` BullMQ queue and returns — it does NOT call
 * Nomba, post any ledger entries, or resolve the lock itself anymore.
 * See worker.ts's transfersWorker (processLedgerDisbursement/callNomba)
 * for where that work now actually happens, in a separate process, once
 * this job reaches the front of the queue.
 *
 * This function claims the lock but never releases it — release only
 * happens in the worker, once the transfer's real outcome is known (see
 * that file's releaseLock/clearPendingOperation/decrementPendingOperationLeg).
 * If this function returns without throwing, the lock is held and WILL be
 * released later by the worker; it is never left claimed with nothing
 * downstream able to clear it, because enqueueing only fails before the
 * lock is claimed (Redis unreachable, etc.) or after (in which case the
 * caller's catch block is responsible for releasing it — see
 * PayoutSchedulerService/TargetBasedPayoutService's try/catch around this
 * call, which treat an enqueue failure as "retry next sweep," not
 * "money moved."
 *
 * amount is EXACTLY what gets disbursed, not necessarily the pot's
 * full balance — see postDisbursement, which passes the full balance for
 * manual/target_based payout and admin refund, vs PayoutSchedulerService,
 * which passes a FIXED amount for recurring/scheduled.
 *
 * onSuccess is how this function tells the worker what to do ONLY once
 * the transfer has actually succeeded — e.g. mark a target_based config
 * fired, advance a recurring config's nextRunAt, or mark a scheduled leg
 * fired (see DisbursementOnSuccess / worker.ts's applyOnSuccess). This
 * exists because the four call sites (triggerPayout,
 * PayoutSchedulerService x2, TargetBasedPayoutService) each need a
 * different follow-up action, and the worker has no direct knowledge of
 * any of those call sites — onSuccess is the caller declaring its own
 * follow-up without the worker importing from every domain service.
 * Never applied by this function itself, and never applied on
 * PENDING_BILLING or failure — only on confirmed transfer success, so a
 * config can never be marked fired/advanced for money that didn't
 * actually move (see system-rules.md's "no silent failures" — the
 * inverse failure mode, silently marking success, is guarded against the
 * same way).
 *
 * contributorUserId, when set, tells the worker this leg belongs to a
 * fan-out refund (postContributorsRefund) with N independent legs sharing
 * one pot-level lock — the worker decrements pendingOperationLegCount on
 * resolution instead of clearing the lock outright, since the other
 * legs may still be in flight (see decrementPendingOperationLeg).
 * Omitted for a single-leg payout/admin-refund, where legCount is always 1
 * and resolution simply clears the lock.
 *
 * Returns void, not a Transaction: no Transaction exists yet at the
 * point this function returns — LedgerService.postTransaction no longer
 * runs here, only inside the worker once the job is actually processed.
 * Callers that previously read a returned Transaction (e.g. to respond
 * to an HTTP request with it) can no longer do so synchronously; the
 * caller must respond as "accepted for processing," not "completed"
 * (see pots.route.ts's /:id/payout using 202, not returning a body).
 */
export async function postFixedAmountDisbursement(
  pot: Pot,
  kind: "payout" | "refund",
  amount: bigint,
  destination: { destinationAccount: string; destinationBank: string },
  onSuccess?: DisbursementOnSuccess,
  contributorUserId?: string
): Promise<void> {
  const reference = `${kind}_${pot.id}_${randomUUID()}`;
  const claimed = await db
    .update(pots)
    .set({ pendingOperation: kind, pendingOperationLegCount: 1 })
    .where(and(eq(pots.id, pot.id), isNull(pots.pendingOperation)))
    .returning({ id: pots.id });

  if (claimed.length === 0) {
    throw new PotError(
      "A payout or refund is already in flight for this pot — wait for it to resolve before triggering another",
      409
    );
  }

  const jobData: DisbursementJobData = {
    kind: kind === "payout" ? "payout" : "pot_refund", // maps service-level "refund" -> job-level "pot_refund"
    potId: pot.id,
    amount: amount.toString(),
    destinationAccount: destination.destinationAccount,
    destinationBank: destination.destinationBank,
    reference,
    onSuccess,
    contributorUserId,
  };

  if (kind === "payout") {
    await TransferQueueService.enqueuePayout(jobData as Extract<DisbursementJobData, { kind: "payout" }>);
  } else {
    await TransferQueueService.enqueuePotRefund(jobData as Extract<DisbursementJobData, { kind: "pot_refund" }>);
  }
}

/** Unconditionally clears a pot's pendingOperation lock (transaction id + leg count included) — used when a single-leg disbursement resolves or fails outright, where there is never more than one leg to account for. */
export async function clearPendingOperation(potId: string): Promise<void> {
  await db
    .update(pots)
    .set({ pendingOperation: null, pendingOperationTransactionId: null, pendingOperationLegCount: null })
    .where(eq(pots.id, potId));
}

/**
 * refundType='contributors' disbursement: refunds every contributor who
 * has a 'funded' contribution to this pot their pro-rata share of the
 * pot's CURRENT balance (not their original contribution amount outright
 * — if a payout already drained part of the pot, each contributor's
 * share shrinks proportionally rather than the trigger being blocked).
 * Contributors with multiple funded contributions are refunded once, as
 * their combined total.
 *
 * Unlike postDisbursement, this posts ONE INDEPENDENT ledger transaction
 * + transfer PER CONTRIBUTOR rather than a single shared transaction — if
 * one contributor's transfer fails, only THEIR leg is reversed; the
 * others' successful transfers stand (see docs/system-rules.md — a
 * failed bank transfer to one recipient has no bearing on money already
 * correctly delivered to another). pendingOperationLegCount tracks how
 * many of the N legs are still outstanding; the pot-level lock only
 * clears once every leg resolves (see resolvePendingTransfer).
 *
 * Integer-kobo pro-rata division leaves a small remainder (less than the
 * number of contributors) uncollected in the pot — left there
 * deliberately rather than distributed unevenly; an admin can drain it
 * with one more small manual operation before closing (see pots.ts
 * status semantics: balance must be zero to close).
 */
async function postContributorsRefund(pot: Pot): Promise<Transaction[]> {
  const funded = await db
    .select({
      contributionId: contributions.id,
      contributorUserId: contributions.contributorUserId,
      expectedAmount: contributions.expectedAmount,
      refundAccountNumber: contributions.refundAccountNumber,
      refundAccountName: contributions.refundAccountName,
      refundBank: contributions.refundBank,
    })
    .from(contributions)
    .where(and(eq(contributions.potId, pot.id), eq(contributions.status, "funded")));

  if (funded.length === 0) {
    throw new PotError("Pot has no funded contributions to refund", 409);
  }

  // Group by contributorUserId so a logged-in contributor's multiple
  // contributions consolidate into one refund. An anonymous contribution
  // (contributorUserId null) has no shared identity to group by, so it
  // gets a synthetic key derived from its own contribution id instead —
  // guaranteed unique, never collapsed with another anonymous contributor
  // (see contributions.ts's contributorUserId comment).
  type FundedRow = (typeof funded)[number];
  const groups = new Map<string, FundedRow[]>();
  let totalContributed = 0n;
  for (const row of funded) {
    const groupKey = row.contributorUserId ?? `anon:${row.contributionId}`;
    const group = groups.get(groupKey);
    if (group) {
      group.push(row);
    } else {
      groups.set(groupKey, [row]);
    }
    totalContributed += row.expectedAmount;
  }

  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);
  if (balance <= 0n) {
    throw new PotError("Pot has no balance to refund", 409);
  }

  // Resolve every group's refund destination(s) and their pro-rata share
  // BEFORE claiming the lock, so a data problem fails loudly before any
  // money moves. A group WITH an explicit refundAccountNumber on file
  // (set at contribution time — see contributions.ts) gets one leg to
  // that account. A group with NO explicit account instead refunds to
  // wherever each of its funding transfers actually came from
  // (contribution_payments.senderAccountNumber/senderBankCode) — one leg
  // PER PAYMENT, split proportionally to what that payment actually
  // contributed, mirroring ExpiryService.sweepExpiredContributions'
  // per-payment refund for never-funded contributions. A contributor who
  // topped up from two different accounts gets refunded to both,
  // proportionally — never guessed as a single destination.
  // numerator/denominator let the fresh-balance rescale below
  // recompute each leg's share as (numerator * freshBalance) /
  // denominator — a single ratio all the way from "this leg's slice"
  // to "the whole pot," so a per-payment leg's numerator/denominator (this
  // payment's amount over this group's total payments, times this group's
  // amount over the pot's total) doesn't need the group-level fan-out
  // logic repeated at rescale time.
  const legs: {
    groupKey: string;
    numerator: bigint;
    denominator: bigint;
    amount: bigint;
    destinationAccount: string;
    destinationBank: string;
    accountName: string;
  }[] = [];
  for (const [groupKey, rows] of groups) {
    const contributed = rows.reduce((sum, r) => sum + r.expectedAmount, 0n);
    const share = (contributed * balance) / totalContributed;
    if (share <= 0n) continue;

    // Every row in a group shares one refund destination — true by
    // construction for a real user (one refund profile), and trivially
    // true for an anonymous group (exactly one row, its own contribution).
    const { refundAccountNumber, refundAccountName, refundBank } = rows[0];

    if (refundAccountNumber && refundAccountName && refundBank) {
      legs.push({
        groupKey,
        numerator: contributed,
        denominator: totalContributed,
        amount: share,
        destinationAccount: refundAccountNumber,
        destinationBank: refundBank,
        accountName: refundAccountName,
      });
      continue;
    }

    // No refund account on file — fan out across this group's actual
    // funding payments instead. expectedAmount (what we refund
    // pro-rata against) can differ from SUM(contribution_payments) for an
    // overpaid contribution (the excess was already refunded back at
    // funding time — see confirmFunding's refundOverpayment call), so
    // scale each payment's OWN share of share by its proportion of
    // this group's total received payments, not of expectedAmount.
    const payments = await db
      .select({
        amount: contributionPayments.amount,
        senderAccountNumber: contributionPayments.senderAccountNumber,
        senderBankCode: contributionPayments.senderBankCode,
        senderName: contributionPayments.senderName,
      })
      .from(contributionPayments)
      .where(
        inArray(
          contributionPayments.contributionId,
          rows.map((r) => r.contributionId)
        )
      );

    if (payments.length === 0) {
      // A funded contribution always has at least one payment (that's
      // what funded it) — this would mean the data is inconsistent, not
      // just "no refund account configured."
      throw new PotError(`Contributor ${groupKey} has no refund destination and no recorded payments`, 409);
    }

    const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0n);
    for (const payment of payments) {
      const paymentShare = (payment.amount * share) / totalPayments;
      if (paymentShare <= 0n) continue;
      legs.push({
        groupKey,
        // this payment's fraction of the pot = (payment / totalPayments) * (contributed / totalContributed)
        // — collapsed to one fraction so rescaling is (numerator * freshBalance) / denominator.
        numerator: payment.amount * contributed,
        denominator: totalPayments * totalContributed,
        amount: paymentShare,
        destinationAccount: payment.senderAccountNumber,
        destinationBank: payment.senderBankCode,
        accountName: payment.senderName,
      });
    }
  }

  if (legs.length === 0) {
    // Every contributor's pro-rata share rounded down to zero (possible
    // when the remaining balance is small relative to contributor count).
    // Claiming the lock here with legCount=0 would never have a leg to
    // decrement it back to zero, stranding pendingOperation permanently.
    throw new PotError("Remaining pot balance is too small to distribute — every contributor's share rounds to zero", 409);
  }

  const claimed = await db
    .update(pots)
    .set({ pendingOperation: "refund", pendingOperationLegCount: legs.length })
    .where(and(eq(pots.id, pot.id), isNull(pots.pendingOperation)))
    .returning({ id: pots.id });

  if (claimed.length === 0) {
    throw new PotError(
      "A payout or refund is already in flight for this pot — wait for it to resolve before triggering another",
      409
    );
  }

  // A contribution can land in the gap between the balance read above and
  // claiming the lock just now — re-read and rescale each leg's share
  // against the fresh balance (same numerator/denominator ratio)
  // rather than posting against a stale snapshot, mirroring
  // postFixedAmountDisbursement's re-read-after-lock pattern.
  const freshBalance = await LedgerService.getBalance(potAccount.id);
  if (freshBalance !== balance) {
    for (const leg of legs) {
      leg.amount = (leg.numerator * freshBalance) / leg.denominator;
    }
  }

  const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
  const results: Transaction[] = [];

  for (const leg of legs) {
    if (leg.amount <= 0n) {
      // Rescaling against the fresh balance left this leg with nothing to
      // send — still release its share of the lock.
      await decrementPendingOperationLeg(pot.id);
      continue;
    }

    // groupKey is either a real contributorUserId or a synthetic
    // "anon:<contributionId>" (see the grouping above) — only ever put the
    // former into metadata.contributorUserId, so that field stays a real
    // user id or absent, never a synthetic string a future reader might
    // mistake for one.
    const isAnonymousGroup = leg.groupKey.startsWith("anon:");
    const reference = `refund_${pot.id}_${leg.groupKey.replace(":", "-")}_${randomUUID()}`;

    const transaction = await LedgerService.postTransaction({
      type: "refund",
      reference,
      status: "processing",
      entries: [
        { accountId: potAccount.id, direction: "debit", amount: leg.amount },
        { accountId: platformFloat.id, direction: "credit", amount: leg.amount },
      ],
      metadata: isAnonymousGroup
        ? { potId: pot.id }
        : { potId: pot.id, contributorUserId: leg.groupKey },
    });
    results.push(transaction);

    try {
      const transfer = await nomba.transferToBankAccount({
        amount: Number(leg.amount) / 100,
        accountNumber: leg.destinationAccount,
        accountName: leg.accountName,
        bankCode: leg.destinationBank,
        merchantTxRef: reference,
        senderName: "Glasspot",
        narration: `Glasspot refund for pot ${pot.id}`,
      });

      if (transfer.status === "SUCCESS") {
        await LedgerService.markCompleted(transaction.id);
        await decrementPendingOperationLeg(pot.id);
      }
      // PENDING_BILLING: this leg stays 'processing' — resolved later by
      // the payout webhook, same as postDisbursement's single-leg path.
    } catch (err) {
      // This leg's transfer was rejected outright — reverse only THIS
      // leg's ledger entry, the others already posted/succeeded stand.
      await LedgerService.reverseTransaction(transaction.id, `${reference}_reversal`);
      await decrementPendingOperationLeg(pot.id);
    }
  }

  return results;
}

/** Decrements a pot's pendingOperationLegCount by one, clearing the whole pendingOperation lock once it reaches zero — the fan-out-refund counterpart to resolvePendingTransfer's same logic for webhook-driven resolution. */
export async function decrementPendingOperationLeg(potId: string): Promise<void> {
  const [updated] = await db
    .update(pots)
    .set({ pendingOperationLegCount: sql`GREATEST(${pots.pendingOperationLegCount} - 1, 0)` })
    .where(eq(pots.id, potId))
    .returning({ legCount: pots.pendingOperationLegCount });

  if (updated && updated.legCount === 0) {
    await db
      .update(pots)
      .set({ pendingOperation: null, pendingOperationTransactionId: null, pendingOperationLegCount: null })
      .where(eq(pots.id, potId));
  }
}
