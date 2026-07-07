import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "@/modules/auth/auth.service";
import { AuthError } from "@/modules/auth/auth.errors";
import { NombaApiError } from "@/integrations/nomba/nomba.error";
import { PotsService } from "@/modules/pots/pots.service";
import { displayNameFor } from "@/modules/pots/pots.controller";
import { koboToNairaString } from "@/lib/money";
import { UpdateRefundProfileInput } from "./me.schema";

/** Maps a thrown error to the right HTTP response: the error's own statusCode for an AuthError, a failed Nomba bank lookup as 400, or a generic 500. */
function handleMeError(e: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (e instanceof AuthError) {
    return reply.code(e.statusCode).send({ message: e.message });
  }
  if (e instanceof NombaApiError) {
    return reply.code(400).send({ message: `Could not verify bank account: ${e.message}` });
  }
  request.log.error({ err: e }, "Unhandled error in me route");
  return reply.code(500).send({ message: "Something went wrong" });
}

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
