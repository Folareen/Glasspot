import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { payoutCronQueue, transfersQueue } from "@/queues/queues";
import env from "@/config/env";

/** Mounts a Bull Board dashboard at /admin/queues for inspecting/retrying jobs on both queues, gated by BULL_BOARD_ENABLED — it has no auth of its own and exposes job payloads (account numbers, amounts), so it must never be reachable in production without a preHandler added below. */
export default fp(async function bullBoardPlugin(app: FastifyInstance) {
  if (!env.BULL_BOARD_ENABLED) {
    return;
  }

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [new BullMQAdapter(payoutCronQueue), new BullMQAdapter(transfersQueue)],
    serverAdapter,
  });

  app.register(serverAdapter.registerPlugin(), {
    prefix: "/admin/queues",
    // ⚠ Add an admin-only preHandler here before this ever runs anywhere
    // but your local machine — see note below.
  });
});