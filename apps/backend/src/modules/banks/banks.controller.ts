import { FastifyReply, FastifyRequest } from "fastify";
import { nomba } from "@/integrations/nomba";
import { verifyAccountDetails, AccountVerificationError } from "@/integrations/nomba/verify-account-details";
import { BankLookupInput } from "./banks.schema";
import env from "@/config/env";

const REFRESH_ALLOWED_USER_IDS = new Set(
  env.BANKS_REFRESH_ALLOWED_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean)
);

/** GET /banks — the full list of bank codes/names, served from cache (see NombaClient.fetchBankCodes). */
export async function listBanksHandler(_request: FastifyRequest, reply: FastifyReply) {
  const banks = await nomba.fetchBankCodes();
  return reply.code(200).send({ banks });
}

/**
 * POST /banks/refresh — force-clears the cached bank list and re-fetches
 * from Nomba. Gated by a narrow user-id allowlist (BANKS_REFRESH_ALLOWED_USER_IDS)
 * since there's no general staff/admin role in this codebase (see
 * pot-authorization.ts: "admin" there is scoped per-pot, not global).
 */
export async function refreshBanksHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user?.sub;
  if (!userId || !REFRESH_ALLOWED_USER_IDS.has(userId)) {
    return reply.code(403).send({ message: "Not authorized to refresh the bank list" });
  }
  const banks = await nomba.refreshBankCodes();
  return reply.code(200).send({ banks });
}

/**
 * POST /banks/lookup — resolves accountNumber/bankCode to the account
 * holder's name, for the frontend to show the user before they confirm a
 * destination anywhere account details are entered (payout config,
 * contributor refund account, refund profile, etc). Read-only — does not
 * save anything.
 */
export async function lookupBankAccountHandler(
  request: FastifyRequest<{ Body: BankLookupInput }>,
  reply: FastifyReply
) {
  try {
    const { accountName } = await verifyAccountDetails(request.body.accountNumber, request.body.bankCode);
    return reply.code(200).send({
      accountNumber: request.body.accountNumber,
      bankCode: request.body.bankCode,
      accountName,
    });
  } catch (err) {
    if (err instanceof AccountVerificationError) {
      return reply.code(err.statusCode).send({ message: err.message });
    }
    throw err;
  }
}
