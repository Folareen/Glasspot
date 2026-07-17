import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "@/modules/auth/auth.service";
import { PotsService } from "@/modules/pots/pots.service";
import { displayNameFor } from "@/modules/pots/pots.controller";
import { koboToNairaString } from "@/lib/money";
import { UpdateRefundProfileInput } from "./me.schema";
import { sendErrorResponse as handleMeError } from "@/lib/http-errors";

/** Returns the caller's own profile, including defaultRefundAccount/defaultRefundBank — previously write-only via PATCH /me/refund-profile. */
export async function getMeHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const profile = await AuthService.getProfile(request.user.sub);
    return reply.code(200).send(profile);
  } catch (e) {
    return handleMeError(e, request, reply);
  }
}

/** Sets the caller's default refund destination bank account (validated against Nomba's bank-lookup API) and responds 200 with the stored profile. */
export async function updateRefundProfileHandler(
  request: FastifyRequest<{ Body: UpdateRefundProfileInput }>,
  reply: FastifyReply
) {
  try {
    const profile = await AuthService.updateRefundProfile(request.user.sub, request.body);
    return reply.code(200).send(profile);
  } catch (e) {
    return handleMeError(e, request, reply);
  }
}

/** Cross-pot activity feed: every transaction posted against any pot the caller is a member of, newest first, each tagged with potId/potTitle. */
export async function listMyTransactionsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const transactions = await PotsService.listTransactionsForUser(request.user.sub);
    return reply.code(200).send(
      transactions.map((t) => ({
        ...t,
        amount: koboToNairaString(t.amount),
        displayName: displayNameFor(t.metadata),
      }))
    );
  } catch (e) {
    return handleMeError(e, request, reply);
  }
}
