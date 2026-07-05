import { FastifyInstance } from "fastify";
import {
  activatePotHandler,
  addMemberHandler,
  closePotHandler,
  contributeHandler,
  createPotHandler,
  getPotHandler,
  listMembersHandler,
  listPotsHandler,
  removeMemberHandler,
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
  MemberParams,
  PotIdParams,
  TriggerPayoutInput,
  UpdateMemberRoleInput,
  UpdatePotInput,
} from "./pots.schema";

/**
 * Every route below passes its RouteGenericInterface as an explicit type
 * argument (e.g. server.post<{ Body: X }>(...)) instead of relying on
 * Fastify to infer it from `schema`. fastify-zod's $ref() schemas are
 * typed as { $ref: string } — not a real JSON Schema shape — so Fastify's
 * schema-based generic inference can't recover a concrete Params/Body
 * type from them and silently falls back to `unknown`, which then fails
 * to typecheck against each controller's explicitly-typed handler. This
 * bites `params` in particular (route.ts had zero params-schema routes
 * before this module, so the gap was latent, not something this module
 * introduced).
 */
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

  server.get(
    "/",
    {
      preHandler: [server.optionalAuthenticate],
      schema: {
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

  server.post<{ Params: PotIdParams; Body: TriggerPayoutInput }>(
    "/:id/payout",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("triggerPayoutSchema"),
        response: { 200: $ref("transactionResponseSchema") },
      },
    },
    triggerPayoutHandler
  );

  server.post<{ Params: PotIdParams }>(
    "/:id/refund",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        response: { 200: $ref("refundResponseSchema") },
      },
    },
    triggerRefundHandler
  );

  server.post<{ Params: PotIdParams; Body: ContributeInput }>(
    "/:id/contributions",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("potIdParamsSchema"),
        body: $ref("contributeSchema"),
        response: { 201: $ref("contributionResponseSchema") },
      },
    },
    contributeHandler
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
        response: { 201: $ref("memberResponseSchema") },
      },
    },
    addMemberHandler
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
}

export default potsRoutes;
