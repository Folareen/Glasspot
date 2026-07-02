import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import db, {
  pots,
  potMembers,
  users,
  transactions,
  targetBasedPayoutConfigs,
  manualPayoutConfigs,
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
    case "manual": {
      const c = input.payoutConfig;
      await db.insert(manualPayoutConfigs).values({
        potId,
        destinationAccount: c.destinationAccount,
        destinationBank: c.destinationBank,
      });
      return;
    }
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
 * even fully possible: manualPayoutConfigSchema and a target_based config
 * with no optional fields set are the identical shape
 * ({ destinationAccount, destinationBank }), and are only told apart by
 * which mode was actually requested.
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
      await db.delete(manualPayoutConfigs).where(eq(manualPayoutConfigs.potId, potId));
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

  /** Admin-only. open -> closed, one-way, terminal. Only reachable once the pot's ledger balance is zero (see pots.ts status semantics). */
  async close(potId: string, userId: string) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Only an open pot can be closed", 409);
    }

    const potAccount = await AccountsService.getOrCreatePotAccount(potId);
    const balance = await LedgerService.getBalance(potAccount.id);
    if (balance !== 0n) {
      throw new PotError("Pot balance must be zero before it can be closed", 409);
    }

    const [updated] = await db
      .update(pots)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(pots.id, potId))
      .returning();

    return updated;
  },

  /**
   * Manual payout trigger. Validates authorization + pot/mode eligibility,
   * then posts the internal leg (debit pot_account, credit
   * platform_float) and calls Nomba to disburse to the mode's configured
   * destination — see postDisbursement() for the full in-flight-lock +
   * transfer-call shape.
   */
  async triggerPayout(potId: string, userId: string) {
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
      // manual mode has no fired/firedAt — it can fire repeatedly over the
      // pot's lifetime (see manual-payout-configs.ts).
      const [config] = await db
        .select()
        .from(manualPayoutConfigs)
        .where(eq(manualPayoutConfigs.potId, potId))
        .limit(1);
      if (!config) {
        throw new PotError("Pot has no manual payout config", 409);
      }
      return postDisbursement(pot, "payout", {
        destinationAccount: config.destinationAccount,
        destinationBank: config.destinationBank,
      });
    }

    throw new PotError(
      `Manual payout trigger is not applicable to payoutMode '${pot.payoutMode}'`,
      400
    );
  },

  /**
   * Manual refund trigger. Posts the internal leg and calls Nomba to
   * disburse the pot's full balance to a single destination — for
   * refundType='admin' that destination is the triggering admin's own
   * defaultRefundAccount/defaultRefundBank on file (spec-mvp.md: refunds
   * "to whoever triggers it"), set via PATCH /auth/me/refund-profile.
   * refundType='contributors' (per-contributor fan-out refund) is a
   * follow-up, not implemented in this pass — see pots.errors.ts message.
   */
  async triggerRefund(potId: string, userId: string) {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "open") {
      throw new PotError("Pot must be open to trigger a refund", 409);
    }

    if (pot.refundType === "contributors") {
      throw new PotError("refundType 'contributors' is not implemented in this build", 400);
    }

    const [triggeringAdmin] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!triggeringAdmin?.defaultRefundAccount || !triggeringAdmin.defaultRefundBank) {
      throw new PotError(
        "Set a default refund bank account (PATCH /auth/me/refund-profile) before triggering an admin refund",
        409
      );
    }

    return postDisbursement(pot, "refund", {
      destinationAccount: triggeringAdmin.defaultRefundAccount,
      destinationBank: triggeringAdmin.defaultRefundBank,
    });
  },

  /**
   * Resolves a payout/refund transaction left 'processing' after a
   * PENDING_BILLING transfer call, once Nomba's transfer.success or
   * transfer.failed webhook reports the outcome — see nomba-webhooks
   * module, the only caller. Matched by merchantTxRef == transactions.reference,
   * which carries potId in its metadata (see postDisbursement). A no-op if
   * the transaction is already resolved (idempotent — see
   * docs/system-rules.md's at-least-once delivery requirement) or unknown.
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

    await db
      .update(pots)
      .set({ pendingOperation: null, pendingOperationTransactionId: null })
      .where(eq(pots.id, potId));
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
 * the transfer.success/transfer.failed webhook (see nomba-webhooks
 * module), never by blind-retrying (system-rules.md). On any failure
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
  // UPDATE ... WHERE pending_operation IS NULL is atomic in Postgres — of
  // two concurrent triggers only one can ever match this row; the other's
  // returning() comes back empty and is rejected before touching the
  // ledger at all.
  const reference = `${kind}_${pot.id}_${randomUUID()}`;
  const claimed = await db
    .update(pots)
    .set({ pendingOperation: kind })
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

    if (balance <= 0n) {
      throw new PotError(`Pot has no balance to ${kind}`, 409);
    }

    transaction = await LedgerService.postTransaction({
      type: kind,
      reference,
      status: "processing",
      entries: [
        { accountId: potAccount.id, direction: "debit", amountKobo: balance },
        { accountId: platformFloat.id, direction: "credit", amountKobo: balance },
      ],
      metadata: { potId: pot.id },
    });

    await db
      .update(pots)
      .set({ pendingOperationTransactionId: transaction.id })
      .where(eq(pots.id, pot.id));

    const transfer = await nomba.transferToBankAccount({
      amount: Number(balance) / 100,
      accountNumber: destination.destinationAccount,
      accountName: resolved.accountName,
      bankCode: destination.destinationBank,
      merchantTxRef: reference,
      senderName: "Glasspot",
      narration: `Glasspot ${kind} for pot ${pot.id}`,
    });

    if (transfer.status === "SUCCESS") {
      await LedgerService.markCompleted(transaction.id);
      await db
        .update(pots)
        .set({ pendingOperation: null, pendingOperationTransactionId: null })
        .where(eq(pots.id, pot.id));
    }
    // PENDING_BILLING: transaction stays 'processing', pendingOperation
    // stays set — resolved later by the transfer.success/transfer.failed
    // webhook (see nomba-webhooks module). Never blind-retried.

    return transaction;
  } catch (err) {
    if (transaction) {
      await LedgerService.reverseTransaction(transaction.id, `${reference}_reversal`);
    }
    await db
      .update(pots)
      .set({ pendingOperation: null, pendingOperationTransactionId: null })
      .where(eq(pots.id, pot.id));
    throw err;
  }
}
