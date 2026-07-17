import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import db, {
  pots,
  potMembers,
  users,
  transactions,
  ledgerEntries,
  accounts,
  contributions,
  contributionPayments,
  targetBasedPayoutConfigs,
  manualPayoutConfigs,
  recurringPayoutConfigs,
  scheduledPayoutConfigs,
  scheduledPayoutLegs,
  type Pot,
  type Transaction,
  type TargetBasedPayoutConfig,
  type ManualPayoutConfig,
  type RecurringPayoutConfig,
  type ScheduledPayoutConfig,
  type ScheduledPayoutLeg,
} from "@/db";
import { PotError } from "./pots.errors";
import { assertIsAdmin, getPotOrThrow } from "./pot-authorization";
import { AccountsService } from "@/modules/ledger/accounts.service";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { verifyAccountDetails } from "@/integrations/nomba/verify-account-details";
import { nairaStringToKobo } from "@/lib/money";
import { OUTBOUND_FEE } from "@/lib/fees";
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

// A self-contained payoutMode + matching payoutConfig pair, as a real discriminated union (not
// derived via Pick<CreatePotInput, ...>, which loses the payoutMode <-> payoutConfig correlation
// the switch below relies on). CreatePotInput already has this shape; update() must build one
// explicitly via validatePayoutModeConfig since updatePotSchema doesn't guarantee the pairing.
type PayoutModeConfigPair =
  | { payoutMode: "target_based"; payoutConfig: z.infer<typeof targetBasedPayoutConfigSchema> }
  | { payoutMode: "manual"; payoutConfig: z.infer<typeof manualPayoutConfigSchema> }
  | { payoutMode: "recurring"; payoutConfig: z.infer<typeof recurringPayoutConfigSchema> }
  | { payoutMode: "scheduled"; payoutConfig: z.infer<typeof scheduledPayoutConfigSchema> };

// Raw (kobo/Date, not yet wire-serialized) return shape of PotsService.getPayoutConfig — a real
// discriminated union (tagged by `mode`) so pots.controller.ts's serializePayoutConfig can switch
// on payoutMode and narrow without an unsound cast, since none of the four config tables share a
// natural discriminant column of their own.
export type PayoutConfigRow =
  | ({ mode: "target_based" } & TargetBasedPayoutConfig)
  | ({ mode: "manual" } & ManualPayoutConfig)
  | ({ mode: "recurring" } & RecurringPayoutConfig)
  | ({ mode: "scheduled" } & ScheduledPayoutConfig & { legs: ScheduledPayoutLeg[] });

/** Generates a random URL-safe slug for a pot's share link. */
function generateShareSlug(): string {
  return randomBytes(8).toString("base64url");
}

/** Case-insensitive title substring filter for PotsService.list; returns rows unchanged if q is omitted or blank. */
function filterByTitle(rows: Pot[], q: string | undefined): Pot[] {
  const query = q?.trim().toLowerCase();
  if (!query) {
    return rows;
  }
  return rows.filter((pot) => pot.title.toLowerCase().includes(query));
}

// pots.schema.ts's z.coerce.date() fields are typed `Date` after z.infer, but Fastify validates
// request.body via AJV only (Zod's coerce never runs), so they're still plain ISO strings at
// runtime. Drizzle needs a real Date, so re-wrap explicitly before any insert/update.
function toDate(value: Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Inserts the one payout config row matching input.payoutMode; every destination is resolved via verifyAccountDetails() (Nomba name-enquiry) before being written. */
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
        targetAmount: c.targetAmount !== undefined ? nairaStringToKobo(c.targetAmount) : undefined,
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
        amount: nairaStringToKobo(c.amount),
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
          amount: nairaStringToKobo(leg.amount),
          scheduledDate: toDate(leg.scheduledDate),
        }))
      );
      return;
    }
  }
}

/** Turns a failed safeParse's ZodError into one readable sentence for a PotError's client-facing message — never the raw ZodError.message (a JSON-ish stringified issue array, not copy authored for an end user). Joins every issue's own message (already human-readable, e.g. a .refine()'s custom message) rather than Zod's default formatting. */
function zodIssuesToMessage(payoutMode: CreatePotInput["payoutMode"], error: z.ZodError): string {
  const issues = error.issues.map((issue) => issue.message).join("; ");
  return `payoutConfig does not match payoutMode '${payoutMode}': ${issues}`;
}

/** Confirms a { payoutMode, payoutConfig } pair from UpdatePotInput actually correspond (updatePotSchema alone only guarantees payoutConfig matches SOME mode, not necessarily this one), and narrows it into a real PayoutModeConfigPair. */
function validatePayoutModeConfig(
  payoutMode: CreatePotInput["payoutMode"],
  payoutConfig: NonNullable<UpdatePotInput["payoutConfig"]>
): PayoutModeConfigPair {
  switch (payoutMode) {
    case "target_based": {
      const result = targetBasedPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(zodIssuesToMessage("target_based", result.error), 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
    case "manual": {
      const result = manualPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(zodIssuesToMessage("manual", result.error), 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
    case "recurring": {
      const result = recurringPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(zodIssuesToMessage("recurring", result.error), 400);
      }
      return { payoutMode, payoutConfig: result.data };
    }
    case "scheduled": {
      const result = scheduledPayoutConfigSchema.safeParse(payoutConfig);
      if (!result.success) {
        throw new PotError(zodIssuesToMessage("scheduled", result.error), 400);
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

  /** Reads back this pot's payoutMode-specific config row (kobo/Date fields still raw — serializePot converts to wire format), or null for a manual-mode pot with no fixed destination configured. */
  async getPayoutConfig(potId: string, payoutMode: Pot["payoutMode"]): Promise<PayoutConfigRow | null> {
    switch (payoutMode) {
      case "target_based": {
        const [config] = await db
          .select()
          .from(targetBasedPayoutConfigs)
          .where(eq(targetBasedPayoutConfigs.potId, potId))
          .limit(1);
        return config ? { mode: "target_based", ...config } : null;
      }
      case "manual": {
        const [config] = await db
          .select()
          .from(manualPayoutConfigs)
          .where(eq(manualPayoutConfigs.potId, potId))
          .limit(1);
        return config ? { mode: "manual", ...config } : null;
      }
      case "recurring": {
        const [config] = await db
          .select()
          .from(recurringPayoutConfigs)
          .where(eq(recurringPayoutConfigs.potId, potId))
          .limit(1);
        return config ? { mode: "recurring", ...config } : null;
      }
      case "scheduled": {
        const [config] = await db
          .select()
          .from(scheduledPayoutConfigs)
          .where(eq(scheduledPayoutConfigs.potId, potId))
          .limit(1);
        if (!config) return null;
        const legs = await db
          .select()
          .from(scheduledPayoutLegs)
          .where(eq(scheduledPayoutLegs.scheduledConfigId, config.id))
          .orderBy(scheduledPayoutLegs.sequenceOrder);
        return { mode: "scheduled", ...config, legs };
      }
    }
  },

  /**
   * Every transaction that has posted a ledger entry against this pot's account (funding,
   * contribution, payout, refund, fee, transfer, reversal — a funded contribution is just
   * type: 'contribution' here, there is no separate contributions list), newest first. Joins
   * through ledgerEntries/accounts rather than a potId column on transactions itself — see
   * ledger-entries.ts/accounts.ts, transactions has no direct FK to pots.
   */
  async listTransactions(potId: string): Promise<Transaction[]> {
    const potAccount = await AccountsService.getOrCreatePotAccount(potId);
    const rows = await db
      .select({ transaction: transactions })
      .from(ledgerEntries)
      .innerJoin(transactions, eq(ledgerEntries.transactionId, transactions.id))
      .where(eq(ledgerEntries.accountId, potAccount.id))
      .orderBy(desc(transactions.createdAt));

    // One entry per (transaction, account) pair in practice, but de-dupe by
    // id defensively rather than assume the join can never fan out.
    const seen = new Set<string>();
    const result: Transaction[] = [];
    for (const { transaction } of rows) {
      if (!seen.has(transaction.id)) {
        seen.add(transaction.id);
        result.push(transaction);
      }
    }
    return result;
  },

  /**
   * Cross-pot activity feed for GET /me/transactions — every transaction posted against any pot
   * userId is a member of (regardless of role), newest first, each tagged with its potId/potTitle
   * since entries here span multiple pots. Same ledgerEntries -> accounts -> transactions join as
   * listTransactions, additionally joined to pots (via accounts.ownerId) for the title and scoped
   * to the caller's memberships via potMembers.
   */
  async listTransactionsForUser(userId: string): Promise<(Transaction & { potId: string; potTitle: string })[]> {
    const rows = await db
      .select({ transaction: transactions, potId: pots.id, potTitle: pots.title })
      .from(potMembers)
      .innerJoin(pots, eq(potMembers.potId, pots.id))
      .innerJoin(
        accounts,
        and(eq(accounts.ownerType, "pot"), eq(accounts.ownerId, pots.id))
      )
      .innerJoin(ledgerEntries, eq(ledgerEntries.accountId, accounts.id))
      .innerJoin(transactions, eq(ledgerEntries.transactionId, transactions.id))
      .where(eq(potMembers.userId, userId))
      .orderBy(desc(transactions.createdAt));

    const seen = new Set<string>();
    const result: (Transaction & { potId: string; potTitle: string })[] = [];
    for (const row of rows) {
      if (!seen.has(row.transaction.id)) {
        seen.add(row.transaction.id);
        result.push({ ...row.transaction, potId: row.potId, potTitle: row.potTitle });
      }
    }
    return result;
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
          input.minContribution !== undefined ? nairaStringToKobo(input.minContribution) : undefined,
        maxContribution:
          input.maxContribution !== undefined ? nairaStringToKobo(input.maxContribution) : undefined,
        goalAmount:
          input.goalAmount !== undefined ? nairaStringToKobo(input.goalAmount) : undefined,
      })
      .returning();

    // Fastify's request-body validation only checks the compiled JSON Schema (AJV), which drops
    // every Zod .refine() (no JSON Schema equivalent) — validatePayoutModeConfig re-parses through
    // the real Zod schema so those refines (targetAmount > fee, at least one of
    // targetDate/targetAmount, manual's both-or-neither destination) actually get enforced here,
    // same as the update() path below already does.
    const pair = validatePayoutModeConfig(input.payoutMode, input.payoutConfig);
    await insertPayoutConfig(pot.id, pair);

    // Creator is inserted as a plain admin row — no special 'creator'
    // privilege exists. See pot-members.ts schema comment.
    await db.insert(potMembers).values({
      potId: pot.id,
      userId: creatorId,
      role: "admin",
    });

    return pot;
  },

  /**
   * Returns pots visible to the caller, optionally narrowed by scope/search.
   * scope='public': every public pot, regardless of membership.
   * scope='mine': only pots (public or private) the caller is a member of — requires userId.
   * scope omitted: the original default — all public pots plus, if authenticated, the
   * caller's own private pots (public+private, deduped, matching the old merged-list behavior).
   * q, if given, filters by a case-insensitive title substring match, applied after scope.
   */
  async list(userId: string | undefined, scope?: "public" | "mine", q?: string) {
    if (scope === "mine") {
      if (!userId) {
        throw new PotError("Authentication required", 401);
      }
      const myMemberships = await db
        .select({ potId: potMembers.potId })
        .from(potMembers)
        .where(eq(potMembers.userId, userId));
      const myPotIds = myMemberships.map((m) => m.potId);
      const myPots =
        myPotIds.length === 0
          ? []
          : await db.select().from(pots).where(inArray(pots.id, myPotIds)).orderBy(desc(pots.createdAt));
      return filterByTitle(myPots, q);
    }

    // Public pots are visible to everyone. Private pots only show up for
    // an authenticated member — filtered in application code rather than
    // a single SQL query since "member of" requires a join per-pot type.
    const allPublic = await db
      .select()
      .from(pots)
      .where(eq(pots.potType, "public"))
      .orderBy(desc(pots.createdAt));

    if (scope === "public" || !userId) {
      return filterByTitle(allPublic, q);
    }

    const myMemberships = await db
      .select({ potId: potMembers.potId })
      .from(potMembers)
      .where(eq(potMembers.userId, userId));
    const myPotIds = new Set(myMemberships.map((m) => m.potId));

    const privatePotsIAmIn =
      myPotIds.size === 0
        ? []
        : (
            await db.select().from(pots).where(eq(pots.potType, "private")).orderBy(desc(pots.createdAt))
          ).filter((p) => myPotIds.has(p.id));

    const combined = [...allPublic, ...privatePotsIAmIn].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return filterByTitle(combined, q);
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
        ...(minContribution !== undefined && { minContribution: nairaStringToKobo(minContribution) }),
        ...(maxContribution !== undefined && { maxContribution: nairaStringToKobo(maxContribution) }),
        ...(goalAmount !== undefined && { goalAmount: nairaStringToKobo(goalAmount) }),
        updatedAt: new Date(),
      })
      .where(eq(pots.id, potId))
      .returning();

    return updated;
  },

  /** Admin-only. Deletes a draft pot outright — no ledger rows can exist yet (money only ever moves on an 'open' pot), so this is a hard delete rather than a status transition; payout config and membership rows cascade via FK. */
  async deleteDraft(potId: string, userId: string): Promise<void> {
    await assertIsAdmin(potId, userId);
    const pot = await getPotOrThrow(potId);

    if (pot.status !== "draft") {
      throw new PotError("Only a draft pot can be deleted", 409);
    }

    await db.delete(pots).where(eq(pots.id, potId));
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
      throw new PotError("A payout or refund is still in flight for this pot. Wait for it to resolve before closing", 409);
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
      throw new PotError("A payout or refund is still in flight for this pot. Wait for it to resolve before closing", 409);
    }

    return updated;
  },

  /**
   * Manual payout trigger — only applicable to payoutMode='manual' (other modes fire exclusively
   * via their own cron sweeps). If the pot has a fixed destination on file it wins over the
   * caller-supplied `destination`, which is ignored rather than merged. `amount` is optional:
   * omit for full-balance payout, or set to disburse only part, leaving the rest for a later
   * trigger — must be >0 and <=balance.
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
        // The recipient receives exactly `amount` — the pot is additionally debited the flat
        // ₦50 outbound fee on top (see apps/backend/src/lib/fees.ts), so the balance must cover
        // both. postFixedAmountDisbursement re-verifies this same check right before enqueueing
        // (the authoritative check, since balance can move between here and then) — this early
        // check just gives a precise 409 naming the actual amount requested.
        if (amount + OUTBOUND_FEE > balance) {
          throw new PotError(
            `amount (${amount}) plus the ₦50 outbound fee exceeds the pot's current balance (${balance})`,
            409
          );
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
   * Manual refund trigger. refundType='admin' disburses to the triggering admin's own
   * defaultRefundAccount/Bank on file; refundType='contributors' fans out to every contributor
   * pro-rata (see postContributorsRefund). Both only enqueue the disbursement(s) — the ledger
   * posting + Nomba call happen later in the worker — so the caller must respond "accepted for
   * processing," not with a completed transaction.
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
        "Set a default refund bank account (PATCH /me/refund-profile) before triggering an admin refund",
        409
      );
    }

    await postDisbursement(pot, "refund", {
      destinationAccount: triggeringAdmin.defaultRefundAccount,
      destinationBank: triggeringAdmin.defaultRefundBank,
    });
  },

  /**
   * Resolves a payout/refund/contribution-expiry-refund transaction left 'processing' after a
   * PENDING_BILLING transfer, once Nomba's webhook reports the outcome. Idempotent — a no-op if
   * already resolved or unknown. Decrements pendingOperationLegCount rather than unconditionally
   * clearing the lock, since a fan-out refund has N independent legs that must all resolve before
   * it releases. On success, also applies the transaction's persisted onSuccess side effect (see
   * transactions.onSuccess's schema comment) — this is the async counterpart to worker.ts's own
   * synchronous success branch, which only covers a transfer that resolved SUCCESS immediately,
   * never one that came back PENDING_BILLING and settled later via this webhook path.
   * A contribution-expiry refund (see worker.ts's processContributionRefund) has no potId/lock at
   * all — its metadata carries contributionPaymentId instead, and success additionally flips that
   * payment's `refunded` flag, mirroring the worker's own synchronous success branch.
   */
  async resolvePendingTransfer(transactionReference: string, outcome: "success" | "failed"): Promise<void> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.reference, transactionReference));

    if (!transaction || transaction.status !== "processing") {
      return;
    }

    const metadata = transaction.metadata as { potId?: string; contributionPaymentId?: string } | null;
    const potId = metadata?.potId;
    const contributionPaymentId = metadata?.contributionPaymentId;

    if (!potId && !contributionPaymentId) {
      return;
    }

    if (outcome === "success") {
      await LedgerService.markCompleted(transaction.id);
      if (transaction.onSuccess) {
        // Dynamic import breaks a module cycle: apply-on-success.ts -> target-based-payout.service.ts
        // -> pots.service.ts (for postDisbursement) would otherwise import back into this file.
        const { applyOnSuccess } = await import("@/modules/scheduler/apply-on-success");
        await applyOnSuccess(transaction.onSuccess);
      }
      if (contributionPaymentId) {
        await db.update(contributionPayments).set({ refunded: true }).where(eq(contributionPayments.id, contributionPaymentId));
      }
    } else {
      await LedgerService.reverseTransaction(transaction.id, `${transaction.reference}_reversal`);
    }

    if (potId) {
      await decrementPendingOperationLeg(potId);
    }
  },
};

/**
 * Shared disbursement path for payout and refund: disburses the pot's FULL current balance via
 * postFixedAmountDisbursement (unlike PayoutSchedulerService, which passes a fixed amount for
 * recurring/scheduled). Unlike an amount-specified payout (see triggerPayout), there's no
 * external amount to add the flat ₦50 outbound fee on top of here — the fee has to come out of
 * the balance itself, so the recipient actually receives `balance - OUTBOUND_FEE`, not the full
 * balance (see apps/backend/src/lib/fees.ts).
 */
export async function postDisbursement(
  pot: Pot,
  kind: "payout" | "refund",
  destination: { destinationAccount: string; destinationBank: string },
  onSuccess?: DisbursementOnSuccess
): Promise<void> {
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);
  const payoutAmount = balance - OUTBOUND_FEE;
  if (payoutAmount <= 0n) {
    throw new PotError(`Pot's balance (${balance}) does not cover the ₦50 outbound fee. Nothing to ${kind}`, 409);
  }
  await postFixedAmountDisbursement(pot, kind, payoutAmount, destination, onSuccess);
}

/**
 * Core single-leg disbursement: claims pots.pendingOperation atomically (locking out a second
 * concurrent trigger), then enqueues the actual work onto the rate-limited `transfers` BullMQ
 * queue and returns — does NOT call Nomba, post ledger entries, or release the lock itself; that
 * happens later in the worker once the transfer's real outcome is known.
 * `amount` is exactly what gets disbursed (not necessarily the full pot balance — see
 * postDisbursement vs PayoutSchedulerService's fixed-amount callers).
 * `onSuccess` runs only on confirmed transfer success (never on PENDING_BILLING or failure) so
 * config state (target_based fired, recurring nextRunAt, scheduled leg fired) is never advanced
 * for money that didn't move.
 * `contributorUserId`, when set, marks this leg as part of a fan-out refund sharing one
 * pot-level lock — the worker decrements pendingOperationLegCount instead of clearing outright.
 */
export async function postFixedAmountDisbursement(
  pot: Pot,
  kind: "payout" | "refund",
  amount: bigint,
  destination: { destinationAccount: string; destinationBank: string },
  onSuccess?: DisbursementOnSuccess,
  contributorUserId?: string
): Promise<void> {
  // The authoritative check (system-rules.md rule 9: never trust a client-supplied amount for
  // execution) — every caller (manual-with-amount, full-balance postDisbursement, target_based,
  // recurring, scheduled, the contributors fan-out) funnels through here, so this is the single
  // place a payout/refund can't proceed without covering its own flat ₦50 outbound fee.
  const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
  const balance = await LedgerService.getBalance(potAccount.id);
  if (amount + OUTBOUND_FEE > balance) {
    throw new PotError(
      `amount (${amount}) plus the ₦50 outbound fee exceeds the pot's current balance (${balance})`,
      409
    );
  }

  const reference = `${kind}_${pot.id}_${randomUUID()}`;
  const claimed = await db
    .update(pots)
    .set({ pendingOperation: kind, pendingOperationLegCount: 1 })
    .where(and(eq(pots.id, pot.id), isNull(pots.pendingOperation)))
    .returning({ id: pots.id });

  if (claimed.length === 0) {
    throw new PotError(
      "A payout or refund is already in flight for this pot. Wait for it to resolve before triggering another",
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
 * Rescales every leg's `amount` to `(numerator * pool) / denominator` (each leg's own
 * already-collapsed fraction of the whole pool — see the comment where per-payment legs build
 * this ratio below), truncating down as before, EXCEPT the leg with the largest share, which
 * instead gets whatever is left over (pool minus every other leg's truncated share). This makes
 * the legs always sum to exactly `pool` — no kobo is ever left stranded in the pot's balance,
 * which matters because pots.service.ts's close() requires balance === 0n exactly. Previously
 * every leg truncated independently, leaving up to `legs.length - 1` kobo permanently stuck (the
 * pot could never be closed after a fractional contributors refund — see README's refund-fix
 * section). The remainder goes to the largest leg rather than a fixed array position so it's
 * vanishingly unlikely to land on a leg that itself then rounds to zero and gets skipped.
 * Mutates each leg's `amount` in place; legs.length must be >= 1.
 */
function distributeExactly(
  legs: { numerator: bigint; denominator: bigint; amount: bigint }[],
  pool: bigint
): void {
  let allocated = 0n;
  let largestIndex = 0;
  for (let i = 0; i < legs.length; i++) {
    legs[i].amount = legs[i].denominator > 0n ? (legs[i].numerator * pool) / legs[i].denominator : 0n;
    allocated += legs[i].amount;
    if (legs[i].amount > legs[largestIndex].amount) largestIndex = i;
  }
  const remainder = pool - allocated;
  legs[largestIndex].amount += remainder;
}

/**
 * Narrows `legs` down to the subset that ends up with a positive share once each firing leg's own
 * flat ₦50 outbound fee is reserved from `balance` — reserving a fee for a leg whose rounded share
 * comes out to zero would strand that ₦50 in the pot forever, since nothing ever fires for it and
 * nothing gives the reservation back. Mutates every leg's `.amount` in place via distributeExactly
 * (firing legs get their real share, dropped legs land on exactly 0n) and returns the surviving
 * legs — an empty array if the balance can't even cover one leg's fee, in which case every leg's
 * `.amount` is explicitly zeroed too.
 */
function narrowToFeeCoveredLegs<T extends { numerator: bigint; denominator: bigint; amount: bigint }>(
  legs: T[],
  balance: bigint
): T[] {
  let firing = legs;
  while (firing.length > 0) {
    const distributable = balance - BigInt(firing.length) * OUTBOUND_FEE;
    if (distributable <= 0n) {
      for (const leg of firing) leg.amount = 0n;
      return [];
    }
    distributeExactly(firing, distributable);
    const nextFiring = firing.filter((leg) => leg.amount > 0n);
    if (nextFiring.length === firing.length) return firing;
    firing = nextFiring;
  }
  return [];
}

/**
 * refundType='contributors' disbursement: refunds every contributor with a 'funded' contribution
 * their pro-rata share of the pot's CURRENT balance (shrinks proportionally if a payout already
 * drained part of the pot). Contributors with multiple funded contributions are refunded once,
 * combined. Enqueues one independent transfer job per contributor — if one fails, only that leg
 * is reversed; the others stand. Every leg's share is truncated down to the kobo except the
 * largest, which absorbs the remainder (see distributeExactly) so the legs always sum to exactly
 * the distributable pool — no kobo is ever left stranded in the pot's balance.
 */
async function postContributorsRefund(pot: Pot): Promise<void> {
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
  // accountName is resolved fresh by the worker's callNomba() immediately
  // before each transfer (same as every other disbursement path), so it
  // isn't tracked per-leg here.
  const legs: {
    groupKey: string;
    numerator: bigint;
    denominator: bigint;
    amount: bigint;
    destinationAccount: string;
    destinationBank: string;
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
      });
    }
  }

  if (legs.length === 0) {
    // Every contributor's pro-rata share rounded down to zero (possible
    // when the remaining balance is small relative to contributor count).
    // Claiming the lock here with legCount=0 would never have a leg to
    // decrement it back to zero, stranding pendingOperation permanently.
    throw new PotError("Remaining pot balance is too small to distribute. Every contributor's share rounds to zero", 409);
  }

  // Each leg is its own independent outbound transfer, so each one needs its own flat ₦50
  // outbound fee reserved (see apps/backend/src/lib/fees.ts) — the worker debits
  // `leg.amount + OUTBOUND_FEE` from the pot per leg, mirroring every other disbursement path.
  // narrowToFeeCoveredLegs recomputes that reserve from only the legs that actually end up
  // firing, so a leg whose rounded share is zero never strands its reserved fee in the pot.
  if (narrowToFeeCoveredLegs(legs, balance).length === 0) {
    throw new PotError(
      `Pot's balance (${balance}) does not cover the ₦50 outbound fee for even one of its ${legs.length} contributor refund(s)`,
      409
    );
  }

  const claimed = await db
    .update(pots)
    .set({ pendingOperation: "refund", pendingOperationLegCount: legs.length })
    .where(and(eq(pots.id, pot.id), isNull(pots.pendingOperation)))
    .returning({ id: pots.id });

  if (claimed.length === 0) {
    throw new PotError(
      "A payout or refund is already in flight for this pot. Wait for it to resolve before triggering another",
      409
    );
  }

  // A contribution can land in the gap between the balance read above and
  // claiming the lock just now — re-read and rescale each leg's share
  // against the fresh balance (same numerator/denominator ratio)
  // rather than posting against a stale snapshot, mirroring
  // postFixedAmountDisbursement's re-read-after-lock pattern. Same fee-reserve narrowing as
  // above — never charged a fee reserve against the fresh balance for a leg that won't fire.
  const freshBalance = await LedgerService.getBalance(potAccount.id);
  if (freshBalance !== balance) {
    narrowToFeeCoveredLegs(legs, freshBalance);
  }

  for (const leg of legs) {
    if (leg.amount <= 0n) {
      // Rescaling against the fresh balance left this leg with nothing to
      // send — still release its share of the lock.
      await decrementPendingOperationLeg(pot.id);
      continue;
    }

    // groupKey is either a real contributorUserId or a synthetic
    // "anon:<contributionId>" (see the grouping above) — only ever put the
    // former into the job's contributorUserId, so that field stays a real
    // user id or absent, never a synthetic string a future reader might
    // mistake for one.
    const isAnonymousGroup = leg.groupKey.startsWith("anon:");
    const reference = `refund_${pot.id}_${leg.groupKey.replace(":", "-")}_${randomUUID()}`;

    // Each leg is its own independent transfer job on the shared,
    // rate-limited transfers queue — the worker posts this leg's ledger
    // transaction, calls Nomba, and resolves/reverses it exactly like any
    // other pot_refund, tracked in failed_jobs on exhaustion like every
    // other disbursement path (see processLedgerDisbursement). isFanOutLeg
    // tells the worker's releaseLock to decrement the shared lock instead
    // of clearing it outright, since the other legs may still be pending.
    const jobData: DisbursementJobData = {
      kind: "pot_refund",
      potId: pot.id,
      amount: leg.amount.toString(),
      destinationAccount: leg.destinationAccount,
      destinationBank: leg.destinationBank,
      reference,
      isFanOutLeg: true,
      contributorUserId: isAnonymousGroup ? undefined : leg.groupKey,
    };
    await TransferQueueService.enqueuePotRefund(jobData as Extract<DisbursementJobData, { kind: "pot_refund" }>);
  }
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
