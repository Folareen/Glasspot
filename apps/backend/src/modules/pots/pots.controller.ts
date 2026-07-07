import { FastifyReply, FastifyRequest } from "fastify";
import { PotsService, type PayoutConfigRow } from "./pots.service";
import { PotMembersService } from "./pot-members.service";
import { PendingMembersService } from "./pending-members.service";
import { ContributionsService } from "./contributions.service";
import { assertIsAdmin, getViewablePotOrThrow } from "./pot-authorization";
import { PotError } from "./pots.errors";
import { ActionOtpService } from "./action-otp.service";
import { hashRequest, withIdempotencyKey } from "@/lib/idempotency.service";
import {
  AddMemberInput,
  ContributeInput,
  CreatePotInput,
  PendingMemberParams,
  ListPotsQuery,
  MemberParams,
  PotIdParams,
  RequestPayoutOtpInput,
  TriggerPayoutInput,
  TriggerRefundInput,
  UpdateMemberRoleInput,
  UpdatePotInput,
} from "./pots.schema";
import { koboToNairaString, nairaStringToKobo } from "@/lib/money";
import type { Pot } from "@/db";

/**
 * The bank-confirmed account-holder name for a transaction row: the sender for a contribution
 * (blank if the contributor chose anonymous), the resolved destination for a payout/refund. Read
 * from transactions.metadata rather than a dedicated column — see worker.ts/contributions.service.ts
 * for where each field is written at disbursement/funding time.
 */
export function displayNameFor(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (m.anonymous === true) return null;
  if (typeof m.senderName === "string") return m.senderName;
  if (typeof m.destinationAccountName === "string") return m.destinationAccountName;
  return null;
}

/** Converts one payoutMode config row (raw kobo bigints/Date fields from PotsService.getPayoutConfig, tagged by `mode`) to its wire shape, or null for manual mode with no fixed destination. Scheduled's legs array is converted leg-by-leg. */
function serializePayoutConfig(config: PayoutConfigRow | null) {
  if (!config) return null;
  switch (config.mode) {
    case "target_based":
      return {
        destinationAccount: config.destinationAccount,
        destinationBank: config.destinationBank,
        destinationAccountName: config.destinationAccountName,
        targetDate: config.targetDate ? config.targetDate.toISOString() : null,
        targetAmount: config.targetAmount !== null ? koboToNairaString(config.targetAmount) : null,
        fired: config.fired,
      };
    case "manual":
      return {
        destinationAccount: config.destinationAccount,
        destinationBank: config.destinationBank,
        destinationAccountName: config.destinationAccountName,
      };
    case "recurring":
      return {
        destinationAccount: config.destinationAccount,
        destinationBank: config.destinationBank,
        destinationAccountName: config.destinationAccountName,
        amount: koboToNairaString(config.amount),
        intervalDays: config.intervalDays,
        nextRunAt: config.nextRunAt.toISOString(),
      };
    case "scheduled":
      return {
        ordered: config.ordered,
        legs: config.legs.map((leg) => ({
          destinationAccount: leg.destinationAccount,
          destinationBank: leg.destinationBank,
          destinationAccountName: leg.destinationAccountName,
          sequenceOrder: leg.sequenceOrder,
          amount: koboToNairaString(leg.amount),
          scheduledDate: leg.scheduledDate.toISOString(),
          fired: leg.fired,
        })),
      };
  }
}

// potResponseSchema declares minContribution/maxContribution/goalAmount/
// balance as naira "NN.NN" strings (see pots.schema.ts's nairaAmount
// comment), but Drizzle returns them as real kobo bigints — every handler
// that sends a pot row back to the client must run it through here first,
// both to convert kobo -> naira (koboToNairaString) and because AJV
// rejects the response with a 500 ("does not match schema definition") the
// moment any of them is a non-null bigint instead of a string. Also
// attaches the pot's current ledger balance (see PotsService.getBalance)
// so callers can show amount contributed against
// minContribution/maxContribution/goalAmount without a separate request,
// and the pot's payoutMode-specific payoutConfig (see PotsService.getPayoutConfig)
// so the frontend never needs a second round trip to render the payout rule.
async function serializePot(pot: Pot) {
  const [balance, payoutConfig] = await Promise.all([
    PotsService.getBalance(pot.id),
    PotsService.getPayoutConfig(pot.id, pot.payoutMode),
  ]);
  return {
    ...pot,
    minContribution: koboToNairaString(pot.minContribution),
    maxContribution: pot.maxContribution !== null ? koboToNairaString(pot.maxContribution) : null,
    goalAmount: pot.goalAmount !== null ? koboToNairaString(pot.goalAmount) : null,
    balance: koboToNairaString(balance),
    payoutConfig: serializePayoutConfig(payoutConfig),
  };
}


// Catches PotError as well as errors from collaborating modules this
// controller now calls into (e.g. LedgerService's LedgerError via
// ContributionsService) — both shapes carry the same
// { name, message, statusCode } contract, so a structural check here
// avoids importing every module's error class into this file.
/** Maps a thrown PotError (or any error exposing a numeric statusCode, e.g. from LedgerService) to its corresponding HTTP response, or a generic 500 otherwise. */
function handlePotError(e: unknown, reply: FastifyReply) {
  if (e instanceof PotError || (e instanceof Error && "statusCode" in e && typeof e.statusCode === "number")) {
    const statusCode = e instanceof PotError ? e.statusCode : (e as { statusCode: number }).statusCode;
    return reply.code(statusCode).send({ message: e.message });
  }
  console.log(e);
  return reply.code(500).send({ message: "Something went wrong" });
}

// request.user's type claims it's always present (see jwt.ts's FastifyJWT
// augmentation), but that's only true behind the hard `server.authenticate`
// preHandler. Routes here use `optionalAuthenticate` instead, which can
// leave it genuinely undefined at runtime for an anonymous caller — the
// `?.` below is load-bearing, not defensive noise, despite what the type
// implies.
/** Returns the requester's userId if authenticated, or undefined for an anonymous caller. */
function currentUserId(request: FastifyRequest): string | undefined {
  return request.user?.sub;
}

/** Returns the requester's userId, or throws a 401 PotError if the request is unauthenticated. */
function requireUserId(request: FastifyRequest): string {
  const userId = currentUserId(request);
  if (!userId) {
    throw new PotError("Authentication required", 401);
  }
  return userId;
}

/** Returns the Idempotency-Key header, or throws a 400 PotError if missing — required on every mutating money endpoint (see docs/system-rules.md). */
function requireIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (!key || Array.isArray(key)) {
    throw new PotError("Idempotency-Key header is required", 400);
  }
  return key;
}

/** Creates a new pot owned by the authenticated requester and responds 201 with the created pot. */
export async function createPotHandler(
  request: FastifyRequest<{ Body: CreatePotInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.create(userId, request.body);
    return reply.code(201).send(await serializePot(pot));
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Lists pots visible to the caller. ?scope=public/mine narrows the result (see PotsService.list); omitted, defaults to public pots plus the caller's own private ones. ?q filters by title substring. */
export async function listPotsHandler(
  request: FastifyRequest<{ Querystring: ListPotsQuery }>,
  reply: FastifyReply
) {
  try {
    const pots = await PotsService.list(currentUserId(request), request.query.scope, request.query.q);
    return reply.code(200).send(await Promise.all(pots.map(serializePot)));
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Returns a single pot by id, or 404 if it doesn't exist or is a private pot the caller can't view. */
export async function getPotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const pot = await getViewablePotOrThrow(request.params.id, currentUserId(request));
    return reply.code(200).send(await serializePot(pot));
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Applies a partial update to a draft pot (admin-only) and responds with the updated pot. */
export async function updatePotHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: UpdatePotInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.update(request.params.id, userId, request.body);
    return reply.code(200).send(await serializePot(pot));
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Transitions a draft pot to 'open' (admin-only) and responds with the updated pot. */
export async function activatePotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.activate(request.params.id, userId);
    return reply.code(200).send(await serializePot(pot));
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Transitions an open pot to 'closed' (admin-only, requires a zero ledger balance) and responds with the updated pot. */
export async function closePotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.close(request.params.id, userId);
    return reply.code(200).send(await serializePot(pot));
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Sends a one-time confirmation code (admin-only) required to trigger a manual payout, bound to this exact destination/amount so it can't be reused for a different one. */
export async function requestPayoutOtpHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: RequestPayoutOtpInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    await ActionOtpService.request(userId, "trigger_payout", request.params.id, request.body);
    return reply.code(200).send({ message: "Confirmation code sent" });
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Manually triggers a payout (admin-only, idempotent per Idempotency-Key), verifying the OTP from requestPayoutOtpHandler before enqueueing the disbursement — never completes it inline. */
export async function triggerPayoutHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: TriggerPayoutInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const key = requireIdempotencyKey(request);
    const requestHash = hashRequest({ method: "POST", path: request.url, userId, body: request.body });
    const { statusCode } = await withIdempotencyKey(key, requestHash, async () => {
      const { otpCode, ...otpContext } = request.body;
      await ActionOtpService.verify(userId, "trigger_payout", request.params.id, otpContext, otpCode);
      const destination =
        request.body?.destinationAccount && request.body?.destinationBank
          ? { destinationAccount: request.body.destinationAccount, destinationBank: request.body.destinationBank }
          : undefined;
      const amount = request.body?.amount !== undefined ? nairaStringToKobo(request.body.amount) : undefined;
      await PotsService.triggerPayout(request.params.id, userId, destination, amount);
      return { statusCode: 202, body: undefined };
    });
    return reply.code(statusCode).send();
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Sends a one-time confirmation code (admin-only) required to trigger a refund. */
export async function requestRefundOtpHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    await ActionOtpService.request(userId, "trigger_refund", request.params.id, undefined);
    return reply.code(200).send({ message: "Confirmation code sent" });
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Manually triggers a full-balance refund (admin-only, idempotent per Idempotency-Key), verifying the OTP from requestRefundOtpHandler before enqueueing the disbursement(s). */
export async function triggerRefundHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: TriggerRefundInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const key = requireIdempotencyKey(request);
    const requestHash = hashRequest({ method: "POST", path: request.url, userId });
    const { statusCode } = await withIdempotencyKey(key, requestHash, async () => {
      await ActionOtpService.verify(userId, "trigger_refund", request.params.id, undefined, request.body.otpCode);
      await PotsService.triggerRefund(request.params.id, userId);
      return { statusCode: 202, body: undefined };
    });
    return reply.code(statusCode).send();
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Issues a virtual account for the caller to fund, idempotent per the Idempotency-Key header, and responds 201 with the pending contribution. userId is undefined for an anonymous contributor to a public pot — see ContributionsService.create. */
export async function contributeHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: ContributeInput }>,
  reply: FastifyReply
) {
  try {
    const userId = currentUserId(request);
    const key = requireIdempotencyKey(request);
    const requestHash = hashRequest({ method: "POST", path: request.url, userId, body: request.body });
    const { statusCode, body } = await withIdempotencyKey(key, requestHash, async () => {
      const contribution = await ContributionsService.create(request.params.id, userId, request.body);
      return {
              statusCode: 201,
              body: { ...contribution, expectedAmount: koboToNairaString(contribution.expectedAmount) },
            };
    });
    // body.expectedAmount is already a naira string here — either just
    // converted above (fresh call) or read back as-is from the cached JSON
    // response of an earlier identical call (see withIdempotencyKey) — so
    // no further conversion happens on this path.
    return reply.code(statusCode).send(body);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Lists a pot's transactions (funding, contribution, payout, refund, fee, transfer, reversal — all in one feed, newest first), after checking the pot is viewable by the requester. Serves both the pot detail Activity tab and "list contributions", since a funded contribution is just type: 'contribution' here. */
export async function listTransactionsHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    await getViewablePotOrThrow(request.params.id, currentUserId(request));
    const transactions = await PotsService.listTransactions(request.params.id);
    return reply.code(200).send(
      transactions.map((t) => ({
        ...t,
        amount: koboToNairaString(t.amount),
        displayName: displayNameFor(t.metadata),
      }))
    );
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Lists a pot's members, after checking the pot is viewable by the requester (404 for a private pot they can't see). */
export async function listMembersHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    // Visibility rule applies to membership listing too — reuses the same
    // 404-on-private-non-member check as viewing the pot itself.
    await getViewablePotOrThrow(request.params.id, currentUserId(request));
    const members = await PotMembersService.list(request.params.id);
    return reply.code(200).send(members);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Adds a member to a pot by email (admin-only): joins immediately if the email belongs to a verified user, otherwise creates a pending row resolved automatically on that person's signup verification. Either way they're emailed the pot link — this is not an invite they accept or decline. */
export async function addMemberHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: AddMemberInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const result = await PendingMembersService.create(request.params.id, userId, request.body);
    const body = result.kind === "member" ? result.member : result.pending;
    return reply.code(201).send(body);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Lists every pending-member row (any status) for a pot (admin-only) — people added by email who haven't signed up/verified yet. */
export async function listPendingMembersHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const pending = await PendingMembersService.list(request.params.id);
    return reply.code(200).send(pending);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Removes a still-pending row (admin-only) and responds 200 — for undoing an add-by-email before that person has signed up. */
export async function removePendingMemberHandler(
  request: FastifyRequest<{ Params: PendingMemberParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    await PendingMembersService.remove(request.params.id, request.params.pendingId);
    return reply.code(200).send({ message: "Pending member removed" });
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Changes a member's role (admin-only), refusing to demote the pot's last remaining admin, and responds with the updated membership row. */
export async function updateMemberRoleHandler(
  request: FastifyRequest<{ Params: MemberParams; Body: UpdateMemberRoleInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const member = await PotMembersService.updateRole(
      request.params.id,
      request.params.userId,
      request.body
    );
    return reply.code(200).send(member);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** Removes a member from a pot (admin-only), refusing to remove the pot's last remaining admin, and responds 200. */
export async function removeMemberHandler(
  request: FastifyRequest<{ Params: MemberParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    await PotMembersService.remove(request.params.id, request.params.userId);
    return reply.code(200).send({ message: "Member removed" });
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/** A member removing themselves from a pot (self-service, no admin check) — refuses if they're the pot's last remaining admin, same as removeMemberHandler's protection. */
export async function leavePotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await PotMembersService.leave(request.params.id, userId);
    return reply.code(200).send({ message: "Left pot" });
  } catch (e) {
    return handlePotError(e, reply);
  }
}
