import { FastifyInstance } from "fastify";
import { getMeHandler, listMyTransactionsHandler, updateRefundProfileHandler } from "./me.controller";
import { $ref, UpdateRefundProfileInput } from "./me.schema";

/** Registers /me/* routes — the caller's own profile, refund destination, and cross-pot activity feed. All require authentication. */
async function meRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      preHandler: [server.authenticate],
      schema: {
        response: { 200: $ref("meResponseSchema") },
      },
    },
    getMeHandler
  );

  server.patch<{ Body: UpdateRefundProfileInput }>(
    "/refund-profile",
    {
      preHandler: [server.authenticate],
      schema: {
        body: $ref("updateRefundProfileSchema"),
        response: { 200: $ref("refundProfileResponseSchema") },
      },
    },
    updateRefundProfileHandler
  );

  server.get(
    "/transactions",
    {
      preHandler: [server.authenticate],
      schema: {
        response: { 200: $ref("meTransactionListResponseSchema") },
      },
    },
    listMyTransactionsHandler
  );
}

export default meRoutes;
