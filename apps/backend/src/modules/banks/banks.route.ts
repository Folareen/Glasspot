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

  server.post<{ Body: BankLookupInput }>(
    "/lookup",
    {
      schema: {
        body: $ref("bankLookupSchema"),
        response: { 200: $ref("bankLookupResponseSchema") },
      },
    },
    lookupBankAccountHandler
  );
}

export default banksRoutes;
