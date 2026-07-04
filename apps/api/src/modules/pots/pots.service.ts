import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import db, {
  pots,
  potMembers,
  users,
  transactions,
  contributions,
  targetBasedPayoutConfigs,
  recurringPayoutConfigs,
  rotationPayoutConfigs,
  rotationPayoutLegs,
  type Pot,
  type Transaction,
} from "@glasspot/db";
import { PotError } from "./pots.errors";
import { assertIsAdmin, getPotOrThrow } from "./pot-authorization";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { nomba } from "@/integrations/nomba";
import {
  CreatePotInput,
  UpdatePotInput,
  manualPayoutConfigSchema,
  recurringPayoutConfigSchema,
  rotationPayoutConfigSchema,
  targetBasedPayoutConfigSchema,
} from "./pots.schema";

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
  | { payoutMode: "rotation"; payoutConfig: z.infer<typeof rotationPayoutConfigSchema> };

/** Generates a random URL-safe slug for a pot's share link. */
function generateShareSlug(): string {
  return randomBytes(8).toString("base64url");
}

/**
 * pots.schema.ts's z.coerce.date() fields (targetDate, nextRunAt,
 * scheduledDate) are typed as `Date` after z.infer, but nothing in this
 * request pipeline actually calls Zod's .parse()/coerce logic — Fastify
 * validates request.body against the compiled JSON Schema via AJV only
 * (see pots.schema.ts's koboAmount/adminManualEnabled comments for the
 * same root cause). A JSON Schema date-time field validates a raw ISO
 * string, so request.body's date fields are still plain strings at
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
 */
async function insertPayoutConfig(potId: string, input: PayoutModeConfigPair) {
  switch (input.payoutMode) {
    case "target_based": {
      const c = input.payoutConfig;
      await db.insert(targetBasedPayoutConfigs).values({
        potId,
        destinationAccount: c.destinationAccount,
        destinationBank: c.destinationBank,
        targetDate: c.targetDate !== undefined ? toDate(c.targetDate) : undefined,
        targetAmountKobo: c.targetAmountKobo !== undefined ? BigInt(c.targetAmountKobo) : undefined,
        adminManualEnabled: c.adminManualEnabled,
      });
      return;
    }
    case "manual":
      // No config row: the destination is picked at trigger time, not
      // creation time — see PotsService.triggerPayout.
      return;
    case "recurring": {
      const c = input.payoutConfig;
      await db.insert(recurringPayoutConfigs).values({
        potId,
        destinationAccount: c.destinationAccount,
        destinationBank: c.destinationBank,
        amountKobo: BigInt(c.amountKobo),
        intervalDays: c.intervalDays,
        nextRunAt: toDate(c.nextRunAt),
      });
      return;
    }
    case "rotation": {
      const c = input.payoutConfig;
      const [rotationConfig] = await db.insert(rotationPayoutConfigs).values({ potId }).returning();
      await db.insert(rotationPayoutLegs).values(
        c.legs.map((leg) => ({
          rotationConfigId: rotationConfig.id,
          sequenceOrder: leg.sequenceOrder,
          destinationAccount: leg.destinationAccount,
          destinationBank: leg.destinationBank,
          amountKobo: BigInt(leg.amountKobo),
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
    case "rotation": {
      const result = rotationPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(`payoutConfig does not match payoutMode 'rotation': ${result.error.message}`, 400);
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
      // No config row to delete — see insertPayoutConfig's manual case.
      return;
    case "recurring":
      await db.delete(recurringPayoutConfigs).where(eq(recurringPayoutConfigs.potId, potId));
      return;
    case "rotation": {
      // rotation_payout_legs cascades on rotation_payout_configs delete.
      await db.delete(rotationPayoutConfigs).where(eq(rotationPayoutConfigs.potId, potId));
      return;
    }
    case "scheduled":
      // Not reachable — 'scheduled' is excluded from payoutModeValues in
      // pots.schema.ts, so no pot in this build can ever hold this value.
      return;
  }
}

export const PotsService = {
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
        minContributionKobo:
          input.minContributionKobo !== undefined ? BigInt(input.minContributionKobo) : undefined,
        maxContributionKobo:
          input.maxContributionKobo !== undefined ? BigInt(input.maxContributionKobo) : undefined,
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
    // pot.payoutMode's DB type includes 'scheduled' (the enum has all 5
    // values even though only 4 are reachable through this API — see
    // pots.schema.ts's payoutModeValues comment), which
    // validatePayoutModeConfig can't accept; guard defensively even
    // though no pot in this build can actually hold that value today.
    if (input.payoutConfig !== undefined) {
      const effectiveMode = input.payoutMode ?? pot.payoutMode;
      if (effectiveMode === "scheduled") {
        throw new PotError("payoutMode 'scheduled' is not available in this build", 400);
      }
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

    const { title, description, minContributionKobo, maxContributionKobo } = input;
    const [updated] = await db
      .update(pots)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(minContributionKobo !== undefined && { minContributionKobo: BigInt(minContributionKobo) }),
        ...(maxContributionKobo !== undefined && { maxContributionKobo: BigInt(maxContributionKobo) }),
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
   * Manual payout trigger. Validates authorization + pot/mode eligibility,
   * then posts the internal leg (debit pot_account, credit
   * platform_float) and calls Nomba to disburse to the destination — see
   * postDisbursement() for the full in-flight-lock + transfer-call shape.
   *
   * destination is only accepted (and required) for payoutMode='manual',
   * where the group's agreed rule is that any admin can send the balance
   * to whichever account they choose at the moment they trigger it — see
   * pots.schema.ts's triggerPayoutSchema comment. Every other mode's
   * destination is fixed at pot creation and read from its own config
   * table instead; a destination passed alongside one of those modes is
   * ignored, not merged in, so there is exactly one source of truth per
   * mode.
   */
  async triggerPayout(
    potId: string,
    userId: string,
    destination?: { destinationAccount: string; destinationBank: string }
  ) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to trigger a payout", 409);
    }

    if (pot.payoutMode === "target_based") {
      const [config] = await db
        .select()
        .from(targetBasedPayoutConfigs)
        .where(eq(targetBasedPayoutConfigs.potId, potId))
        .limit(1);
      if (!config?.adminManualEnabled) {
        throw new PotError("This pot's target_based rule does not allow admin manual trigger", 403);
      }
      if (config.fired) {
        throw new PotError("Payout has already fired for this pot", 409);
      }
      const transaction = await postDisbursement(pot, "payout", {
        destinationAccount: config.destinationAccount,
        destinationBank: config.destinationBank,
      });
      await db
        .update(targetBasedPayoutConfigs)
        .set({ fired: true, firedAt: new Date() })
        .where(eq(targetBasedPayoutConfigs.potId, potId));
      return transaction;
    }

    if (pot.payoutMode === "manual") {
      // manual mode fires repeatedly over the pot's lifetime, to whichever
      // account the triggering admin names each time — see this method's
      // top comment.
      if (!destination?.destinationAccount || !destination.destinationBank) {
        throw new PotError(
          "destinationAccount and destinationBank are required to trigger a manual payout",
          400
        );
      }
      return postDisbursement(pot, "payout", destination);
    }

    throw new PotError(
      `Manual payout trigger is not applicable to payoutMode '${pot.payoutMode}'`,
      400
    );
  },

  /**
   * Manual refund trigger. refundType='admin' posts the internal leg and
   * disburses the pot's full balance to a single destination — the
   * triggering admin's own defaultRefundAccount/defaultRefundBank on file
   * (spec-mvp.md: refunds "to whoever triggers it"), set via PATCH
   * /auth/me/refund-profile. refundType='contributors' fans out to every
   * contributor pro-rata instead — see postContributorsRefund(). Always
   * returns an array (one element for refundType='admin', one per
   * contributor for refundType='contributors') so the wire contract is
   * uniform regardless of which refund mode the pot uses.
   */
  async triggerRefund(potId: string, userId: string): Promise<Transaction[]> {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to trigger a refund", 409);
    }

    if (pot.refundType === "contributors") {
      return postContributorsRefund(pot);
    }

    const [triggeringAdmin] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!triggeringAdmin?.defaultRefundAccount || !triggeringAdmin.defaultRefundBank) {
      throw new PotError(
        "Set a default refund bank account (PATCH /auth/me/refund-profile) before triggering an admin refund",
        409
      );
    }

    const transaction = await postDisbursement(pot, "refund", {
      destinationAccount: triggeringAdmin.defaultRefundAccount,
      destinationBank: triggeringAdmin.defaultRefundBank,
    });
    return [transaction];
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
 * instant must not both trigger the payout call"), then: looks up the
 * destination, posts the internal ledger leg (debit pot_account, credit
 * platform_float) for the pot's full current balance, and calls Nomba's
 * transfer API.
 *
 * On SUCCESS, resolves immediately: transaction -> completed,
 * pendingOperation cleared. On PENDING_BILLING, leaves both the
 * transaction and pendingOperation as-is — resolution happens later via
 * the payout_success/payout_failed/payout_refund webhook (see
 * nomba-webhooks module), never by blind-retrying (system-rules.md). On any failure
 * (destination lookup, insufficient balance, or the transfer call itself
 * rejected outright), releases the lock — reversing the internal ledger
 * leg too if it was already posted, since we know for certain the
 * transfer never started.
 */
async function postDisbursement(
  pot: Pot,
  kind: "payout" | "refund",
  destination: { destinationAccount: string; destinationBank: string }
): Promise<Transaction> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);
  if (balance <= 0n) {
    throw new PotError(`Pot has no balance to ${kind}`, 409);
  }
  return postFixedAmountDisbursement(pot, kind, balance, destination);
}

/**
 * Core single-leg disbursement: claims pots.pendingOperation atomically
 * (locking out a second concurrent trigger — see docs/system-rules.md's
 * "two members approving in the same instant must not both trigger the
 * payout call"), then looks up the destination, posts the internal ledger
 * leg (debit pot_account, credit platform_float) for EXACTLY amountKobo
 * (not necessarily the pot's full balance — see postDisbursement, which
 * passes the full balance for manual/target_based payout and admin
 * refund, vs PayoutSchedulerService, which passes a FIXED amount for
 * recurring/rotation), and calls Nomba's transfer API.
 *
 * On SUCCESS, resolves immediately: transaction -> completed,
 * pendingOperation cleared. On PENDING_BILLING, leaves both the
 * transaction and pendingOperation as-is — resolution happens later via
 * the payout_success/payout_failed/payout_refund webhook (see
 * nomba-webhooks module), never by blind-retrying (system-rules.md). On
 * any failure (destination lookup, insufficient balance, or the transfer
 * call itself rejected outright), releases the lock — reversing the
 * internal ledger leg too if it was already posted, since we know for
 * certain the transfer never started.
 */
export async function postFixedAmountDisbursement(
  pot: Pot,
  kind: "payout" | "refund",
  amountKobo: bigint,
  destination: { destinationAccount: string; destinationBank: string }
): Promise<Transaction> {
  // UPDATE ... WHERE pending_operation IS NULL is atomic in Postgres — of
  // two concurrent triggers only one can ever match this row; the other's
  // returning() comes back empty and is rejected before touching the
  // ledger at all.
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

  let transaction: Transaction | undefined;

  try {
    const resolved = await nomba.lookupBankAccount(destination.destinationAccount, destination.destinationBank);

    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const balance = await LedgerService.getBalance(potAccount.id);

    if (balance < amountKobo) {
      throw new PotError(`Pot balance is insufficient to ${kind} ${amountKobo} kobo`, 409);
    }

    transaction = await LedgerService.postTransaction({
      type: kind,
      reference,
      status: "processing",
      entries: [
        { accountId: potAccount.id, direction: "debit", amountKobo },
        { accountId: platformFloat.id, direction: "credit", amountKobo },
      ],
      metadata: { potId: pot.id },
    });

    await db
      .update(pots)
      .set({ pendingOperationTransactionId: transaction.id })
      .where(eq(pots.id, pot.id));

    const transfer = await nomba.transferToBankAccount({
      amount: Number(amountKobo) / 100,
      accountNumber: destination.destinationAccount,
      accountName: resolved.accountName,
      bankCode: destination.destinationBank,
      merchantTxRef: reference,
      senderName: "Glasspot",
      narration: `Glasspot ${kind} for pot ${pot.id}`,
    });

    if (transfer.status === "SUCCESS") {
      await LedgerService.markCompleted(transaction.id);
      await clearPendingOperation(pot.id);
    }
    // PENDING_BILLING: transaction stays 'processing', pendingOperation
    // stays set — resolved later by the payout_success/payout_failed/
    // payout_refund webhook (see nomba-webhooks module). Never blind-retried.

    return transaction;
  } catch (err) {
    if (transaction) {
      await LedgerService.reverseTransaction(transaction.id, `${reference}_reversal`);
    }
    await clearPendingOperation(pot.id);
    throw err;
  }
}

/** Unconditionally clears a pot's pendingOperation lock (transaction id + leg count included) — used when a single-leg disbursement resolves or fails outright, where there is never more than one leg to account for. */
async function clearPendingOperation(potId: string): Promise<void> {
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
    .select({ contributorUserId: contributions.contributorUserId, expectedAmountKobo: contributions.expectedAmountKobo })
    .from(contributions)
    .where(and(eq(contributions.potId, pot.id), eq(contributions.status, "funded")));

  if (funded.length === 0) {
    throw new PotError("Pot has no funded contributions to refund", 409);
  }

  const totalsByContributor = new Map<string, bigint>();
  let totalContributedKobo = 0n;
  for (const row of funded) {
    totalsByContributor.set(
      row.contributorUserId,
      (totalsByContributor.get(row.contributorUserId) ?? 0n) + row.expectedAmountKobo
    );
    totalContributedKobo += row.expectedAmountKobo;
  }

  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);
  if (balance <= 0n) {
    throw new PotError("Pot has no balance to refund", 409);
  }

  // Resolve every contributor's refund destination (validated at
  // contribution time — see contributions.ts) and their pro-rata share
  // BEFORE claiming the lock, so a data problem (missing refund profile)
  // fails loudly before any money moves.
  const legs: { userId: string; contributedKobo: bigint; amountKobo: bigint; destinationAccount: string; destinationBank: string; accountName: string }[] = [];
  for (const [userId, contributedKobo] of totalsByContributor) {
    const shareKobo = (contributedKobo * balance) / totalContributedKobo;
    if (shareKobo <= 0n) continue;

    const [contribution] = await db
      .select({ refundAccountNumber: contributions.refundAccountNumber, refundAccountName: contributions.refundAccountName, refundBank: contributions.refundBank })
      .from(contributions)
      .where(and(eq(contributions.potId, pot.id), eq(contributions.contributorUserId, userId), eq(contributions.status, "funded")))
      .limit(1);

    if (!contribution?.refundAccountNumber || !contribution.refundAccountName || !contribution.refundBank) {
      throw new PotError(`Contributor ${userId} has no refund destination on file`, 409);
    }

    legs.push({
      userId,
      contributedKobo,
      amountKobo: shareKobo,
      destinationAccount: contribution.refundAccountNumber,
      destinationBank: contribution.refundBank,
      accountName: contribution.refundAccountName,
    });
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
  // against the fresh balance (same contributedKobo/totalContributedKobo
  // ratios) rather than posting against a stale snapshot, mirroring
  // postFixedAmountDisbursement's re-read-after-lock pattern.
  const freshBalance = await LedgerService.getBalance(potAccount.id);
  if (freshBalance !== balance) {
    for (const leg of legs) {
      leg.amountKobo = (leg.contributedKobo * freshBalance) / totalContributedKobo;
    }
  }

  const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
  const results: Transaction[] = [];

  for (const leg of legs) {
    if (leg.amountKobo <= 0n) {
      // Rescaling against the fresh balance left this leg with nothing to
      // send — still release its share of the lock.
      await decrementPendingOperationLeg(pot.id);
      continue;
    }

    const reference = `refund_${pot.id}_${leg.userId}_${randomUUID()}`;

    const transaction = await LedgerService.postTransaction({
      type: "refund",
      reference,
      status: "processing",
      entries: [
        { accountId: potAccount.id, direction: "debit", amountKobo: leg.amountKobo },
        { accountId: platformFloat.id, direction: "credit", amountKobo: leg.amountKobo },
      ],
      metadata: { potId: pot.id, contributorUserId: leg.userId },
    });
    results.push(transaction);

    try {
      const transfer = await nomba.transferToBankAccount({
        amount: Number(leg.amountKobo) / 100,
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
async function decrementPendingOperationLeg(potId: string): Promise<void> {
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
