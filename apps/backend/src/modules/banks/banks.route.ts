import { FastifyInstance } from "fastify";
import { listBanksHandler, lookupBankAccountHandler, refreshBanksHandler } from "./banks.controller";
import { $ref, BankLookupInput } from "./banks.schema";

async function banksRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        response: { 200: $ref("bankListResponseSchema") },
      },
    },
    listBanksHandler
  );

  server.post(
    "/refresh",
    {
      preHandler: [server.authenticate],
      schema: {
        response: { 200: $ref("bankListResponseSchema") },
      },
    },
    refreshBanksHandler
  );

  // Deliberately NOT behind server.authenticate: the landing page's anonymous "Try It" flow
  // (components/landing/TryItModal.tsx) needs live account-name confirmation before signup too,
  // and apps/web's lookupBankAccount() doesn't set skipAuthRedirect, so requiring auth here would
  // hard-redirect an anonymous caller straight to /login mid-typing. Rate-limited instead, to
  // bound the actual abuse case (unmetered enumeration/quota-burning) without breaking that flow.
  server.post<{ Body: BankLookupInput }>(
    "/lookup",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("bankLookupSchema"),
        response: { 200: $ref("bankLookupResponseSchema") },
      },
    },
    lookupBankAccountHandler
  );
}

export default banksRoutes;
