import { FastifyInstance } from "fastify";
import {
  activatePotHandler,
  addMemberHandler,
  removePendingMemberHandler,
  closePotHandler,
  contributeHandler,
  createPotHandler,
  getPotHandler,
  leavePotHandler,
  listPendingMembersHandler,
  listMembersHandler,
  listPotsHandler,
  listTransactionsHandler,
  removeMemberHandler,
  requestPayoutOtpHandler,
  requestRefundOtpHandler,
  triggerPayoutHandler,
  triggerRefundHandler,
  updateMemberRoleHandler,
  updatePotHandler,
} from "./pots.controller";
import { $ref } from "./pots.schema";
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
import { TransferQueueService } from "../scheduler/transfer-queue.service";
import type { DisbursementJobData } from "@/modules/scheduler/disbursement-job.types";

/** Registers all pot-related routes; each passes its RouteGenericInterface explicitly since fastify-zod's $ref() schemas can't be inferred by Fastify. */
async function potsRoutes(server: FastifyInstance) {
  server.post<{ Body: CreatePotInput }>(
    "/",
    {
      preHandler: [server.authenticate],
      schema: {
        body: $ref("createPotSchema"),
        response: { 201: $ref("potResponseSchema") },
      },
    },
    createPotHandler
  );

  server.get<{ Querystring: ListPotsQuery }>(
    "/",
    {
      preHandler: [server.optionalAuthenticate],
      schema: {
        querystring: $ref("listPotsQuerySchema"),
        response: { 200: $ref("potListResponseSchema") },
      },
    },
    listPotsHandler
  );

  server.get<{ Params: PotIdParams }>(
    "/:id",
    {
      preHandler: [server.optionalAuthenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("potResponseSchema") },
      },
    },
    getPotHandler
  );

  server.patch<{ Params: PotIdParams; Body: UpdatePotInput }>(
    "/:id",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("updatePotSchema"),
        response: { 200: $ref("potResponseSchema") },
      },
    },
    updatePotHandler
  );

  server.post<{ Params: PotIdParams }>(
    "/:id/activate",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("potResponseSchema") },
      },
    },
    activatePotHandler
  );

  server.post<{ Params: PotIdParams }>(
    "/:id/close",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("potResponseSchema") },
      },
    },
    closePotHandler
  );

  server.post<{ Params: PotIdParams; Body: RequestPayoutOtpInput }>(
    "/:id/payout/otp",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("requestPayoutOtpSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    requestPayoutOtpHandler
  );

  server.post<{ Params: PotIdParams; Body: TriggerPayoutInput }>(
    "/:id/payout",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("triggerPayoutSchema"),
        response: { 202: {} },
      },
    },
    triggerPayoutHandler
  );

  server.post<{ Params: PotIdParams }>(
    "/:id/refund/otp",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    requestRefundOtpHandler
  );

  server.post<{ Params: PotIdParams; Body: TriggerRefundInput }>(
    "/:id/refund",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("triggerRefundSchema"),
        response: { 202: {} },
      },
    },
    triggerRefundHandler
  );

  // optionalAuthenticate, not authenticate: a public pot accepts
  // contributions from an unauthenticated caller too (docs/spec.md —
  // "public: anyone can view and contribute"). Visibility for a private
  // pot is still enforced inside ContributionsService.create via
  // getViewablePotOrThrow, which 404s an anonymous or non-member caller.
  server.post<{ Params: PotIdParams; Body: ContributeInput }>(
    "/:id/contributions",
    {
      preHandler: [server.optionalAuthenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("contributeSchema"),
        response: { 201: $ref("contributionResponseSchema") },
      },
    },
    contributeHandler
  );

  server.get<{ Params: PotIdParams }>(
    "/:id/transactions",
    {
      preHandler: [server.optionalAuthenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("transactionListResponseSchema") },
      },
    },
    listTransactionsHandler
  );

  server.get<{ Params: PotIdParams }>(
    "/:id/members",
    {
      preHandler: [server.optionalAuthenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("memberListResponseSchema") },
      },
    },
    listMembersHandler
  );

  server.post<{ Params: PotIdParams; Body: AddMemberInput }>(
    "/:id/members",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("addMemberSchema"),
        response: { 201: $ref("addMemberResponseSchema") },
      },
    },
    addMemberHandler
  );

  server.get<{ Params: PotIdParams }>(
    "/:id/pending-members",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("pendingMemberListResponseSchema") },
      },
    },
    listPendingMembersHandler
  );

  server.delete<{ Params: PendingMemberParams }>(
    "/:id/pending-members/:pendingId",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("pendingMemberParamsSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    removePendingMemberHandler
  );

  server.patch<{ Params: MemberParams; Body: UpdateMemberRoleInput }>(
    "/:id/members/:userId",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("memberParamsSchema"),
        body: $ref("updateMemberRoleSchema"),
        response: { 200: $ref("memberResponseSchema") },
      },
    },
    updateMemberRoleHandler
  );

  server.delete<{ Params: MemberParams }>(
    "/:id/members/:userId",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("memberParamsSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    removeMemberHandler
  );

  // Self-service leave (no assertIsAdmin) — distinct from removeMemberHandler above, which is
  // admin-managed removal of someone else.
  server.post<{ Params: PotIdParams }>(
    "/:id/leave",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    leavePotHandler
  );

  server.post<{ Body: { amount?: string } }>("/transfers/test-payout", async (request, reply) => {
    const payload = {
      kind: "payout",
      potId: "test-pot-id",
      amount: request.body?.amount ?? "10000",
      destinationAccount: "1000000001",
      destinationBank: "000013",
      reference: `dev-test-payout-${Date.now()}`,
    };

    // @ts-ignore
    const job = await TransferQueueService.enqueuePayout(payload);
    return reply.send({ jobId: job.id });
  });
}

export default potsRoutes;
