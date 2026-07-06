import { FastifyReply, FastifyRequest } from "fastify";
import { PotsService } from "./pots.service";
import { PotMembersService } from "./pot-members.service";
import { ContributionsService } from "./contributions.service";
import { assertIsAdmin, getViewablePotOrThrow } from "./pot-authorization";
import { PotError } from "./pots.errors";
import { ActionOtpService } from "./action-otp.service";
import { hashRequest, withIdempotencyKey } from "@/lib/idempotency.service";
import {
  AddMemberInput,
  ContributeInput,
  CreatePotInput,
  MemberParams,
  PotIdParams,
  RequestPayoutOtpInput,
  TriggerPayoutInput,
  TriggerRefundInput,
  UpdateMemberRoleInput,
  UpdatePotInput,
} from "./pots.schema";
import { TransferQueueService } from "@/modules/scheduler/transfer-queue.service";
import type { Pot } from "@/db";

// potResponseSchema declares minContribution/maxContribution/
// goalAmount as strings (JSON has no bigint), but Drizzle returns them
// as real bigints — every handler that sends a pot row back to the client
// must run it through here first, or AJV rejects the response with a 500
// ("does not match schema definition") the moment any of them is a
// non-null bigint. Also attaches the pot's current ledger balance (see
// PotsService.getBalance) so callers can show amount contributed against
// minContribution/maxContribution/goalAmount without a
// separate request.
async function serializePot(pot: Pot) {
  const balance = await PotsService.getBalance(pot.id);
  return {
    ...pot,
    minContribution: pot.minContribution.toString(),
    maxContribution: pot.maxContribution?.toString() ?? null,
    goalAmount: pot.goalAmount?.toString() ?? null,
    balance: balance.toString(),
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

/** Lists public pots plus, if the caller is authenticated, their private pots too. */
export async function listPotsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const pots = await PotsService.list(currentUserId(request));
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

/**
 * Sends a one-time confirmation code (admin-only) to the requesting
 * admin's email, required to actually trigger a manual payout — see
 * ActionOtpService.request and triggerPayoutHandler below. Body is the
 * same destination/amount the admin intends to pay out with, hashed into
 * the code's contextHash so it can't later be reused to approve a
 * different destination/amount.
 */
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

/**
 * Manually triggers a payout for an eligible pot (admin-only), idempotent
 * per the Idempotency-Key header, and responds 202 with no body — the
 * disbursement is only enqueued here, not completed (see
 * PotsService.triggerPayout/postFixedAmountDisbursement). request.body
 * only matters for payoutMode='manual', where it carries the destination
 * the triggering admin is sending to this time — see PotsService.triggerPayout
 * and pots.schema.ts's triggerPayoutSchema. Included in the idempotency
 * hash (unlike activate/close, which take no body) since two
 * manual-payout retries with the same key but different destinations must
 * not silently collapse to whichever one happened to run first.
 *
 * otpCode must match the code most recently sent by
 * requestPayoutOtpHandler for this exact destination/amount — verified
 * here, before PotsService.triggerPayout runs, so a stolen session alone
 * can't move money out of the pot (see ActionOtpService.verify).
 */
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
      const amount = request.body?.amount !== undefined ? BigInt(request.body.amount) : undefined;
      await PotsService.triggerPayout(request.params.id, userId, destination, amount);
      return { statusCode: 202, body: undefined };
    });
    return reply.code(statusCode).send();
  } catch (e) {
    return handlePotError(e, reply);
  }
}

/**
 * Sends a one-time confirmation code (admin-only) to the requesting
 * admin's email, required to actually trigger a refund — see
 * ActionOtpService.request and triggerRefundHandler below. No body to
 * bind (refund takes none), so the code's contextHash is just
 * hashActionContext(undefined).
 */
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

/**
 * Manually triggers a refund, draining the pot's full balance
 * (admin-only), idempotent per the Idempotency-Key header, and responds
 * 202 with no body — the disbursement(s) are only enqueued here, not
 * completed (see PotsService.triggerRefund). otpCode must match the code
 * most recently sent by requestRefundOtpHandler — see triggerPayoutHandler's
 * equivalent comment above.
 */
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
              body: { ...contribution, expectedAmount: contribution.expectedAmount.toString() },
            };
    });
    return reply.code(statusCode).send({ ...body, expectedAmount: body.expectedAmount.toString() });
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

/** Adds a new member to a pot (admin-only invite) and responds 201 with the created membership row. */
export async function addMemberHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: AddMemberInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const member = await PotMembersService.add(request.params.id, userId, request.body);
    return reply.code(201).send(member);
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

// export async function adminTriggerPayoutHandler(
//   request: FastifyRequest<{ Params: PotIdParams }>,
//   reply: FastifyReply
// ) {
//   const { id: potId } = request.params;

//   // Resolve destination/amount/accountName from the pot's payout config —
//   // mirrors what PayoutCronHandlers does for the scheduled sweeps, just
//   // triggered manually here instead of by a cron condition.
//   const payoutDetails = await PotPayoutService.resolvePayoutDetails(potId);

//   const job = await TransferQueueService.enqueuePayout({
//     potId,
//     destinationAccount: payoutDetails.destinationAccount,
//     destinationBank: payoutDetails.destinationBank,
//     accountName: payoutDetails.accountName,
//     amount: payoutDetails.amount,
//     merchantTxRef: `admin-payout-${potId}-${Date.now()}`,
//   });

//   return reply.code(202).send();
// }